"""
Arena — API REST (FastAPI)

Lancer : python -m uvicorn app.api:app --reload --port 8000

Endpoints :
  GET  /                           → frontend dashboard
  GET  /quiz                       → page jeu
  GET  /docs                       → Swagger UI (documentation interactive)

  GET  /api/stats                  → métriques globales
  GET  /api/top10                  → Top 10 Redis
  GET  /api/joueurs                → liste tous les joueurs
  GET  /api/joueur/{id}            → profil complet (Mongo + Redis + Neo4j)
  POST /api/joueur                 → créer un joueur dans les 3 bases
  DELETE /api/joueur/{id}          → supprimer des 3 bases

  GET  /api/classement-amis/{id}   → classement entre amis (Neo4j + Redis)
  GET  /api/amis/{id}              → amis directs
  GET  /api/amis-damis/{id}        → suggestions (amis d'amis)
  POST /api/ami                    → ajouter une amitié
  DELETE /api/ami                  → supprimer une amitié

  PUT  /api/score/{id}             → ajouter / retirer des points
  PUT  /api/niveau/{id}            → modifier le niveau

  POST /api/objet/{id}             → ajouter un objet à l'inventaire
  DELETE /api/objet/{id}           → retirer un objet

  POST /api/auth/mot-de-passe      → définir / changer le mot de passe
  POST /api/auth/login             → connexion → JWT

  POST /api/quiz/start             → démarrer une partie
  POST /api/quiz/answer            → répondre à une question
  GET  /api/historique/{id}        → dernières parties (MongoDB)
  GET  /api/stats-joueur/{id}      → statistiques personnelles agrégées

  WS   /ws/top10                   → Top 10 en temps réel (WebSocket)
"""

import json
import logging
import secrets
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import auth_service as auth
from app import config as cfg
from app.joueur_service import JoueurService
from app.quiz_service import Partie, NB_QUESTIONS, TEMPS_LIMITE
from app.services import mongo_service as mongo
from app.services import neo4j_service as neo4j

logger = logging.getLogger("arena")

# ─────────────────────────────────────────────
# App FastAPI — métadonnées Swagger
# ─────────────────────────────────────────────
app = FastAPI(
    title="Arena — Jeu en Ligne NoSQL",
    description=(
        "API backend d'un jeu en ligne multijoueur utilisant **trois bases NoSQL** :\n\n"
        "- **MongoDB** — profils, inventaires et historique des parties\n"
        "- **Redis** — scores, classement mondial (Sorted Set) et sessions de quiz\n"
        "- **Neo4j** — réseau d'amitié et recommandations (traversal graphe)\n\n"
        "Le quiz de calcul mental met à jour les scores Redis en temps réel "
        "et notifie tous les dashboards ouverts via WebSocket."
    ),
    version="2.0.0",
    contact={"name": "Équipe Arena", "email": "arena@example.com"},
    license_info={"name": "MIT"},
    openapi_tags=[
        {"name": "Classements",  "description": "Top 10 et classements entre amis via Redis"},
        {"name": "Joueurs",      "description": "CRUD joueurs — MongoDB + Redis + Neo4j"},
        {"name": "Amitiés",      "description": "Graphe social Neo4j"},
        {"name": "Inventaire",   "description": "Inventaire MongoDB"},
        {"name": "Auth",         "description": "Authentification JWT (mots de passe PBKDF2-SHA256)"},
        {"name": "Quiz",         "description": "Partie de calcul mental chronométrée"},
        {"name": "Historique",   "description": "Statistiques personnelles MongoDB"},
        {"name": "Temps réel",   "description": "WebSocket — Top 10 en direct"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR  = Path(__file__).parent.parent / "frontend" / "static"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ─────────────────────────────────────────────
# Gestionnaire de service (réessaie si bases pas prêtes)
# ─────────────────────────────────────────────
def _creer_service(tentatives: int = 30, pause: float = 2.0) -> JoueurService:
    for essai in range(1, tentatives + 1):
        try:
            return JoueurService()
        except Exception as e:
            print(f"[api] bases non prêtes ({essai}/{tentatives}) : {e}")
            time.sleep(pause)
    raise RuntimeError("MongoDB/Redis/Neo4j injoignables après plusieurs tentatives")


service = _creer_service()

# ─────────────────────────────────────────────
# Gestionnaires d'erreurs globaux (point 6)
# ─────────────────────────────────────────────

@app.exception_handler(Exception)
async def handler_erreur_generique(request: Request, exc: Exception) -> JSONResponse:
    """Transforme toute exception non gérée en 500 avec un message clair.

    Le détail de l'exception est journalisé côté serveur uniquement :
    il n'est jamais renvoyé au client (pas de fuite d'informations internes).
    """
    logger.exception("Erreur non gérée sur %s %s", request.method, request.url.path)
    msg = str(exc)
    # Distingue les erreurs de connexion aux bases
    if any(kw in msg.lower() for kw in ("connection refused", "serviceunavailable", "sessionexpired")):
        return JSONResponse(
            status_code=503,
            content={"detail": "Une base de données est inaccessible. Vérifiez que Docker tourne."},
        )
    return JSONResponse(
        status_code=500,
        content={"detail": "Erreur interne du serveur."},
    )


# ─────────────────────────────────────────────
# WebSocket — connexions actives
# ─────────────────────────────────────────────
connexions_ws: set[WebSocket] = set()


async def diffuser_top10() -> None:
    """Envoie le Top 10 frais à tous les clients WebSocket connectés."""
    await diffuser_evenement({"type": "top10", "top": service.get_top_10_global()})


async def diffuser_evenement(evenement: dict) -> None:
    """Envoie un événement JSON arbitraire à tous les clients WebSocket connectés."""
    if not connexions_ws:
        return
    try:
        message = json.dumps(evenement, default=str)
    except Exception as e:
        logger.warning("diffusion impossible : %s", e)
        return
    morts = []
    for ws in list(connexions_ws):
        try:
            await ws.send_text(message)
        except Exception:
            morts.append(ws)
    connexions_ws.difference_update(morts)


# ─────────────────────────────────────────────
# Modèles Pydantic avec exemples Swagger
# ─────────────────────────────────────────────

class JoueurCreate(BaseModel):
    id:           str = Field(..., example="j11", description="Identifiant unique commun aux 3 bases")
    pseudo:       str = Field(..., example="Alice",  description="Nom affiché")
    niveau:       int = Field(1,   ge=1, le=100, example=1)
    score:        int = Field(0,   ge=0, example=0)
    mot_de_passe: str = Field("",  example="monSecret42", description="Optionnel — active l'authentification")


class AmitiéCreate(BaseModel):
    id_a: str = Field(..., example="j1")
    id_b: str = Field(..., example="j2")


class ScoreUpdate(BaseModel):
    points: int = Field(..., example=100, description="Positif pour ajouter, négatif pour retirer")


class NiveauUpdate(BaseModel):
    niveau: int = Field(..., ge=1, le=100, example=5)


class ObjetAction(BaseModel):
    objet: str = Field(..., example="épée")
    qte:   int = Field(1,  ge=1, example=1)


class DemandeAmiCreate(BaseModel):
    id_de:   str = Field(..., example="j3", description="Demandeur")
    id_vers: str = Field(..., example="j1", description="Cible qui devra accepter")


class QuizStart(BaseModel):
    joueur_id: str = Field(..., example="j1")
    mode:       str = Field("classe", example="classe",
                            description="'classe' (compte au classement) ou 'entrainement' (sans score)")


class QuizAnswer(BaseModel):
    partie_id: str = Field(..., example="a3f9c12d")
    reponse:   str = Field("",  example="42")


class AuthDefinir(BaseModel):
    joueur_id:    str = Field(..., example="j1")
    mot_de_passe: str = Field(..., min_length=4, example="monSecret42")


class AuthLogin(BaseModel):
    joueur_id:    str = Field(..., example="j1")
    mot_de_passe: str = Field(..., example="monSecret42")


# ─────────────────────────────────────────────
# Frontend
# ─────────────────────────────────────────────

@app.get("/", include_in_schema=False)
def root():
    index = FRONTEND_DIR / "index.html"
    return FileResponse(str(index)) if index.exists() else {"message": "Frontend introuvable"}


@app.get("/quiz", include_in_schema=False)
def quiz_page():
    page = FRONTEND_DIR / "quiz.html"
    return FileResponse(str(page)) if page.exists() else JSONResponse(
        status_code=404, content={"detail": "Quiz page introuvable"}
    )


# ─────────────────────────────────────────────
# Classements
# ─────────────────────────────────────────────

@app.get(
    "/api/top10",
    tags=["Classements"],
    summary="Top 10 global",
    response_description="Liste des 10 meilleurs joueurs par score décroissant",
)
def get_top10():
    """Lit le Sorted Set Redis `classement_global` et enrichit avec les pseudos MongoDB."""
    return service.get_top_10_global()


@app.get(
    "/api/classement",
    tags=["Classements"],
    summary="Classement global paginé (tous les joueurs)",
)
def get_classement(page: int = 1, par_page: int = 20):
    """Classement complet au-delà du Top 10, page par page (Redis ZREVRANGE + total ZCARD)."""
    total, entrees = service.redis.get_classement_page(page, par_page)
    pseudos = mongo.get_pseudos([pid for pid, _ in entrees])
    debut_rang = (max(1, page) - 1) * min(max(1, par_page), 100)
    return {
        "total":    total,
        "page":     max(1, page),
        "par_page": min(max(1, par_page), 100),
        "entrees": [
            {"rang": debut_rang + i + 1, "id": pid, "nom": pseudos.get(pid) or "Inconnu", "score": score}
            for i, (pid, score) in enumerate(entrees)
        ],
    }


@app.get(
    "/api/classement-autour/{joueur_id}",
    tags=["Classements"],
    summary="Classement autour d'un joueur (lui inclus)",
)
def get_classement_autour(joueur_id: str, rayon: int = 3):
    """Fenêtre `rayon` joueurs avant/après le joueur dans le classement global."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    rang, fenetre = service.redis.get_autour(joueur_id, rayon)
    if rang is None:
        return {"rang": None, "entrees": [], "message": "Ce joueur n'est pas encore classé"}
    pseudos = mongo.get_pseudos([pid for _, pid, _ in fenetre])
    return {
        "rang": rang,
        "entrees": [
            {"rang": r, "id": pid, "nom": pseudos.get(pid) or "Inconnu", "score": score}
            for r, pid, score in fenetre
        ],
    }


@app.get(
    "/api/classement-amis/{joueur_id}",
    tags=["Classements"],
    summary="Classement entre amis",
    response_description="Amis du joueur + lui-même, triés par score",
)
def get_classement_amis(joueur_id: str):
    """
    Combine **Neo4j** (liste des amis) → **Redis** (scores) → **MongoDB** (pseudos).
    Démontre l'intégration des 3 bases en une seule requête métier.
    """
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    return service.get_classement_amis(joueur_id)


@app.get(
    "/api/stats",
    tags=["Classements"],
    summary="Métriques globales",
)
def get_stats():
    """Statistiques de la plateforme : nombre de joueurs, leader, score maximum."""
    total_redis = service.redis.get_nombre_joueurs()
    total_mongo = mongo.compter_joueurs()
    top1 = service.get_top_10_global()
    return {
        "joueurs_classes": total_redis,
        "joueurs_total":   total_mongo,
        "leader":          top1[0] if top1 else None,
    }


# ─────────────────────────────────────────────
# Joueurs
# ─────────────────────────────────────────────

@app.get("/api/joueurs", tags=["Joueurs"], summary="Lister tous les joueurs")
def get_joueurs():
    """Retourne tous les joueurs MongoDB enrichis de leur score et rang Redis."""
    joueurs_list = mongo.lister_joueurs()
    result = []
    for j in joueurs_list:
        score = service.redis.get_score(j["_id"])
        rang  = service.redis.get_rang(j["_id"])
        result.append({
            "id":         j["_id"],
            "pseudo":     j.get("pseudo", "?"),
            "niveau":     j.get("niveau", 1),
            "score":      score,
            "rang":       rang,
            "inventaire": j.get("inventaire", []),
        })
    result.sort(key=lambda x: x["score"] or 0, reverse=True)
    return result


@app.get(
    "/api/joueur/{joueur_id}",
    tags=["Joueurs"],
    summary="Profil complet d'un joueur",
    response_description="Profil MongoDB + score/rang Redis + amis Neo4j",
)
def get_joueur(joueur_id: str):
    """
    Agrège les données des **3 bases** en un seul objet :
    - `pseudo`, `niveau`, `inventaire` → MongoDB
    - `score`, `rang` → Redis
    - `amis`, `nb_amis` → Neo4j
    """
    profil = mongo.get_profil(joueur_id)
    if not profil:
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    score = service.redis.get_score(joueur_id)
    rang  = service.redis.get_rang(joueur_id)
    amis  = neo4j.get_amis(joueur_id)
    return {
        "id":         profil["_id"],
        "pseudo":     profil.get("pseudo", "?"),
        "niveau":     profil.get("niveau", 1),
        "score":      score,
        "rang":       rang,
        "inventaire": profil.get("inventaire", []),
        "amis":       amis,
        "nb_amis":    len(amis),
    }


@app.post(
    "/api/joueur",
    status_code=201,
    tags=["Joueurs"],
    summary="Créer un joueur",
    response_description="Confirmation de création",
)
def creer_joueur(data: JoueurCreate):
    """
    Crée le joueur **simultanément** dans les 3 bases avec rollback de compensation :
    si Neo4j échoue après MongoDB et Redis, les données orphelines sont supprimées.
    """
    if mongo.joueur_existe(data.id):
        raise HTTPException(409, f"Le joueur '{data.id}' existe déjà")
    service.creer_joueur(data.id, data.pseudo, data.niveau, data.score,
                         mot_de_passe=data.mot_de_passe)
    return {"message": f"Joueur '{data.pseudo}' créé avec succès", "id": data.id}


@app.delete("/api/joueur/{joueur_id}", tags=["Joueurs"], summary="Supprimer un joueur")
def supprimer_joueur(joueur_id: str):
    """Supprime le joueur des **3 bases** (MongoDB + Redis + Neo4j)."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    pseudo = mongo.get_pseudo(joueur_id)
    service.supprimer_joueur(joueur_id)
    return {"message": f"Joueur '{pseudo}' supprimé des 3 bases"}


@app.put("/api/score/{joueur_id}", tags=["Joueurs"], summary="Mettre à jour le score")
def update_score(
    joueur_id: str,
    data: ScoreUpdate,
    background_tasks: BackgroundTasks,
):
    """
    Incrémente (ou décrémente) le score Redis.
    Notifie tous les dashboards via WebSocket (tâche de fond).

    Endpoint synchrone (`def`) : FastAPI l'exécute dans un threadpool,
    les appels bloquants Redis ne gelent jamais la boucle d'événements.
    """
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    nouveau = service.redis.increment_score(joueur_id, data.points)
    rang    = service.redis.get_rang(joueur_id)
    service.redis.publier_maj_scores()
    background_tasks.add_task(diffuser_top10)
    return {"joueur_id": joueur_id, "nouveau_score": int(nouveau), "rang": rang}


@app.put("/api/niveau/{joueur_id}", tags=["Joueurs"], summary="Modifier le niveau")
def update_niveau(joueur_id: str, data: NiveauUpdate):
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    mongo.modifier_niveau(joueur_id, data.niveau)
    return {"joueur_id": joueur_id, "nouveau_niveau": data.niveau}


# ─────────────────────────────────────────────
# Inventaire
# ─────────────────────────────────────────────

@app.post("/api/objet/{joueur_id}", tags=["Inventaire"], summary="Ajouter un objet")
def ajouter_objet(joueur_id: str, data: ObjetAction):
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    mongo.ajouter_objet(joueur_id, data.objet, data.qte)
    return {"message": f"{data.qte}x {data.objet} ajouté"}


@app.delete("/api/objet/{joueur_id}", tags=["Inventaire"], summary="Retirer un objet")
def retirer_objet(joueur_id: str, data: ObjetAction):
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    mongo.retirer_objet(joueur_id, data.objet, data.qte)
    return {"message": f"{data.qte}x {data.objet} retiré"}


# ─────────────────────────────────────────────
# Amitiés
# ─────────────────────────────────────────────

@app.get(
    "/api/amis/{joueur_id}",
    tags=["Amitiés"],
    summary="Amis directs",
    response_description="Liste des amis avec leur score Redis",
)
def get_amis(joueur_id: str):
    """Lit le graphe Neo4j et enrichit chaque ami avec son score/rang Redis."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    amis = neo4j.get_amis(joueur_id)
    for ami in amis:
        ami["score"] = service.redis.get_score(ami["id"])
        ami["rang"]  = service.redis.get_rang(ami["id"])
    return amis


@app.get(
    "/api/amis-damis/{joueur_id}",
    tags=["Amitiés"],
    summary="Suggestions d'amis",
    response_description="Amis d'amis triés par nombre d'amis en commun",
)
def get_amis_damis(joueur_id: str):
    """Traversal Neo4j à 2 degrés — exclut les amis déjà directs."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    return neo4j.get_amis_d_amis(joueur_id)


@app.post("/api/ami", status_code=201, tags=["Amitiés"], summary="Ajouter une amitié")
def ajouter_ami(data: AmitiéCreate):
    for pid in [data.id_a, data.id_b]:
        if not mongo.joueur_existe(pid):
            raise HTTPException(404, f"Joueur '{pid}' introuvable")
    ok = neo4j.ajouter_ami(data.id_a, data.id_b)
    if not ok:
        raise HTTPException(409, "Ces joueurs sont déjà amis ou IDs invalides")
    pa = mongo.get_pseudo(data.id_a)
    pb = mongo.get_pseudo(data.id_b)
    return {"message": f"{pa} et {pb} sont maintenant amis"}


@app.delete("/api/ami", tags=["Amitiés"], summary="Supprimer une amitié")
def supprimer_ami(data: AmitiéCreate):
    ok = neo4j.supprimer_ami(data.id_a, data.id_b)
    if not ok:
        raise HTTPException(404, "Ces joueurs ne sont pas amis")
    return {"message": "Amitié supprimée"}


# ─────────────────────────────────────────────
# Graphe social complet (visualisation)
# ─────────────────────────────────────────────

@app.get(
    "/api/graphe",
    tags=["Amitiés"],
    summary="Graphe social complet pour visualisation",
    response_description="Nœuds (joueurs + scores) et arêtes (amitiés acceptées)",
)
def get_graphe():
    """
    Une requête par base, tout le graphe en un objet :
    - **Neo4j**  → toutes les amitiés confirmées
    - **MongoDB** → pseudos et niveaux
    - **Redis**  → scores (une seule lecture ZRANGE)
    """
    aretes = neo4j.aretes_acceptees()
    joueurs = mongo.lister_joueurs()
    scores = service.redis.tous_les_scores()
    noeuds = [
        {
            "id":     j["_id"],
            "pseudo": j.get("pseudo", "?"),
            "niveau": j.get("niveau", 1),
            "score":  scores.get(j["_id"]),
        }
        for j in joueurs
    ]
    return {"noeuds": noeuds, "aretes": aretes}


# ─────────────────────────────────────────────
# Demandes d'ami (en attente → accepter / refuser)
# ─────────────────────────────────────────────

@app.post(
    "/api/demande-ami",
    status_code=201,
    tags=["Amitiés"],
    summary="Envoyer une demande d'ami",
)
def envoyer_demande_ami(data: DemandeAmiCreate):
    """Crée une relation **en attente** : `id_vers` devra l'accepter."""
    for pid in [data.id_de, data.id_vers]:
        if not mongo.joueur_existe(pid):
            raise HTTPException(404, f"Joueur '{pid}' introuvable")
    ok = neo4j.demander_ami(data.id_de, data.id_vers)
    if not ok:
        raise HTTPException(409, "Demande impossible : déjà amis, demande déjà en cours, ou IDs invalides")
    return {"message": f"Demande d'ami envoyée à '{mongo.get_pseudo(data.id_vers)}'"}


@app.get(
    "/api/demandes-ami/{joueur_id}",
    tags=["Amitiés"],
    summary="Demandes d'ami reçues et envoyées",
)
def get_demandes_ami(joueur_id: str):
    """**Neo4j** : relations `AMI_DE` en attente, séparées selon leur sens."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    return neo4j.get_demandes(joueur_id)


@app.post("/api/demande-ami/accepter", tags=["Amitiés"], summary="Accepter une demande d'ami")
def accepter_demande_ami(data: DemandeAmiCreate):
    """`id_vers` accepte la demande de `id_de` → la relation devient une amitié."""
    ok = neo4j.accepter_demande(data.id_de, data.id_vers)
    if not ok:
        raise HTTPException(404, "Aucune demande en attente entre ces joueurs")
    return {"message": f"{mongo.get_pseudo(data.id_de)} et {mongo.get_pseudo(data.id_vers)} sont maintenant amis"}


@app.post("/api/demande-ami/refuser", tags=["Amitiés"], summary="Refuser une demande d'ami")
def refuser_demande_ami(data: DemandeAmiCreate):
    """`id_vers` refuse la demande de `id_de` → la relation en attente est supprimée."""
    ok = neo4j.refuser_demande(data.id_de, data.id_vers)
    if not ok:
        raise HTTPException(404, "Aucune demande en attente entre ces joueurs")
    return {"message": "Demande refusée"}


# ─────────────────────────────────────────────
# Auth — JWT + mots de passe PBKDF2
# ─────────────────────────────────────────────

def _joueur_du_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return auth.lire_token(authorization[len("Bearer "):].strip())


def _autoriser_gestion_mot_de_passe(
    joueur_id: str,
    authorization: str | None,
    x_admin_key: str | None,
) -> None:
    """Le mot de passe d'un joueur ne peut être défini que par lui-même
    (Bearer token correspondant) ou par un administrateur (X-Admin-Key).

    Sans cette règle, quiconque connaît un joueur_id pouvait lui poser un
    mot de passe puis se connecter à sa place (prise de contrôle de compte).
    """
    if _joueur_du_token(authorization) == joueur_id:
        return
    if cfg.ADMIN_TOKEN and x_admin_key and secrets.compare_digest(x_admin_key, cfg.ADMIN_TOKEN):
        return
    if _joueur_du_token(authorization) is None:
        raise HTTPException(401, "Authentification requise (connectez-vous pour définir un mot de passe)")
    raise HTTPException(403, "Ce token ne permet pas de modifier ce joueur")


@app.post(
    "/api/auth/mot-de-passe",
    tags=["Auth"],
    summary="Définir / changer le mot de passe",
    response_description="Confirmation",
)
def definir_mot_de_passe(
    data: AuthDefinir,
    authorization: str | None = Header(default=None),
    x_admin_key: str | None = Header(default=None),
):
    """
    Hash le mot de passe avec **PBKDF2-SHA256** (100 000 itérations) + sel aléatoire
    et le stocke dans le profil MongoDB. Aucun mot de passe en clair n'est sauvegardé.

    **Autorisation requise** : Bearer token du joueur lui-même, ou en-tête
    `X-Admin-Key` (clé d'administration). Personne ne peut poser un mot de passe
    sur le compte d'autrui.
    """
    _autoriser_gestion_mot_de_passe(data.joueur_id, authorization, x_admin_key)
    if not mongo.joueur_existe(data.joueur_id):
        raise HTTPException(404, f"Joueur '{data.joueur_id}' introuvable")
    mongo.definir_mot_de_passe(data.joueur_id, auth.hacher_mot_de_passe(data.mot_de_passe))
    return {"message": f"Mot de passe défini pour '{data.joueur_id}'"}


@app.post(
    "/api/auth/login",
    tags=["Auth"],
    summary="Connexion — obtenir un JWT",
    response_description="Token JWT signé (HS256)",
)
def login(data: AuthLogin):
    """
    Retourne un **token JWT** signé si le mot de passe est correct.

    Les joueurs sans mot de passe (données de seed) peuvent jouer sans token
    — `token` est alors `null` et `sans_mot_de_passe` est `true`.
    """
    stocke = mongo.get_mot_de_passe(data.joueur_id)
    if stocke is None:
        if not mongo.joueur_existe(data.joueur_id):
            raise HTTPException(404, f"Joueur '{data.joueur_id}' introuvable")
        return {
            "token":            None,
            "joueur_id":        data.joueur_id,
            "sans_mot_de_passe": True,
            "message":          "Ce joueur n'a pas de mot de passe (mode héritage)",
        }
    if not auth.verifier_mot_de_passe(data.mot_de_passe, stocke):
        raise HTTPException(401, "Mot de passe incorrect")
    return {
        "token":            auth.creer_token(data.joueur_id),
        "joueur_id":        data.joueur_id,
        "sans_mot_de_passe": False,
    }


# ─────────────────────────────────────────────
# Quiz
# ─────────────────────────────────────────────

@app.post(
    "/api/quiz/start",
    tags=["Quiz"],
    summary="Démarrer une partie",
    response_description="ID de partie + première question",
)
def quiz_start(data: QuizStart, authorization: str | None = Header(default=None)):
    """
    Démarre une partie de **10 questions** chronométrées (10 s chacune).

    - Si le joueur a défini un mot de passe, un **token JWT valide** est requis.
    - Les joueurs sans mot de passe (seed) peuvent jouer directement.
    - L'état de la partie est stocké dans **Redis** (TTL 10 min).
    """
    if not mongo.joueur_existe(data.joueur_id):
        raise HTTPException(404, f"Joueur '{data.joueur_id}' introuvable")

    if mongo.get_mot_de_passe(data.joueur_id) is not None:
        joueur_token = _joueur_du_token(authorization)
        if joueur_token is None:
            raise HTTPException(401, "Token requis pour ce joueur (connecte-toi)")
        if joueur_token != data.joueur_id:
            raise HTTPException(403, "Ce token ne correspond pas à ce joueur")

    if data.mode not in ("classe", "entrainement"):
        raise HTTPException(422, "mode doit valoir 'classe' ou 'entrainement'")

    partie = Partie(data.joueur_id, mode=data.mode)
    question = partie.question_suivante()
    partie_id = uuid.uuid4().hex[:12]
    service.redis.sauver_partie(partie_id, partie.to_dict())

    return {
        "partie_id":    partie_id,
        "pseudo":       mongo.get_pseudo(data.joueur_id),
        "mode":         partie.mode,
        "nb_questions": NB_QUESTIONS,
        "temps_limite": TEMPS_LIMITE,
        "numero":       1,
        "question":     question,
    }


@app.post(
    "/api/quiz/answer",
    tags=["Quiz"],
    summary="Répondre à une question",
    response_description="Résultat + prochaine question ou fin de partie",
)
def quiz_answer(
    data: QuizAnswer,
    background_tasks: BackgroundTasks,
):
    """
    Vérifie la réponse côté serveur. Points = 10 + (temps_restant arrondi).

    À la fin de la partie :
    - Le score est incrémenté dans **Redis**
    - La partie est enregistrée dans **MongoDB** (historique)
    - Tous les dashboards reçoivent le nouveau Top 10 via **WebSocket** (tâche de fond)

    Endpoint synchrone (`def`) : les appels bloquants Redis/Mongo s'exécutent
    dans un threadpool, sans bloquer la boucle d'événements.
    """
    etat = service.redis.charger_partie(data.partie_id)
    if etat is None or etat["question"] is None:
        raise HTTPException(404, "Partie introuvable ou déjà terminée")

    partie = Partie.from_dict(etat)
    resultat = partie.repondre(data.reponse)

    # Compteur de bonnes réponses (pour l'historique)
    bonnes_avant = etat.get("nb_bonnes", 0)
    nb_bonnes = bonnes_avant + (1 if resultat["correct"] else 0)

    # Durée cumulée (pour l'historique)
    duree_cumulee = etat.get("duree_cumulee", 0.0) + resultat["temps"]

    if resultat["correct"] and partie.comptabilisee:
        service.redis.increment_score(partie.joueur_id, resultat["points"])
        service.redis.publier_maj_scores()

    reponse = {
        **resultat,
        "score_partie": partie.score,
        "termine":      partie.terminee,
    }

    if partie.terminee:
        if partie.comptabilisee:
            # Enregistrement dans MongoDB (historique des parties)
            mongo.enregistrer_partie(
                partie.joueur_id,
                points=partie.score,
                duree_secondes=duree_cumulee,
                nb_bonnes=nb_bonnes,
            )
            reponse["nouveau_score"] = int(service.redis.get_score(partie.joueur_id) or 0)
            reponse["rang"]          = service.redis.get_rang(partie.joueur_id)
            reponse["score_partie"]  = partie.score
            # Événement "activité" pour les notifications en direct
            background_tasks.add_task(
                diffuser_evenement,
                {
                    "type": "activite",
                    "joueur_id": partie.joueur_id,
                    "pseudo":  mongo.get_pseudo(partie.joueur_id) or partie.joueur_id,
                    "points":  partie.score,
                    "bonnes":  nb_bonnes,
                },
            )
        else:
            # Mode entraînement : rien n'est compté, juste le résultat
            reponse["entrainement"] = True
        service.redis.supprimer_partie(data.partie_id)
        background_tasks.add_task(diffuser_top10)
    else:
        reponse["numero"]   = partie.numero
        reponse["question"] = partie.question_suivante()
        etat_maj = {**partie.to_dict(), "nb_bonnes": nb_bonnes, "duree_cumulee": duree_cumulee}
        service.redis.sauver_partie(data.partie_id, etat_maj)

    return reponse


# ─────────────────────────────────────────────
# Historique et statistiques personnelles
# ─────────────────────────────────────────────

@app.get(
    "/api/historique/{joueur_id}",
    tags=["Historique"],
    summary="Dernières parties d'un joueur",
    response_description="Liste chronologique inverse des parties (MongoDB)",
)
def get_historique(joueur_id: str, limite: int = 10):
    """
    Retourne les **dernières parties** jouées, stockées dans la collection
    MongoDB `historique_parties`. Chaque document contient points, durée,
    nombre de bonnes réponses et date.
    """
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    return mongo.get_historique(joueur_id, limite)


@app.get(
    "/api/stats-joueur/{joueur_id}",
    tags=["Historique"],
    summary="Statistiques personnelles agrégées",
    response_description="Nombre de parties, meilleur score, moyenne (agrégation MongoDB)",
)
def get_stats_joueur(joueur_id: str):
    """
    Utilise une **pipeline d'agrégation MongoDB** (`$group`) pour calculer :
    - Nombre total de parties
    - Meilleur score sur une partie
    - Score moyen
    - Total de bonnes réponses
    """
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    return mongo.get_stats_joueur(joueur_id)


# ─────────────────────────────────────────────
# WebSocket — Top 10 en temps réel
# ─────────────────────────────────────────────

@app.websocket("/ws/top10")
async def ws_top10(ws: WebSocket):
    """
    Connexion WebSocket persistante.
    Le client reçoit le Top 10 immédiatement puis à chaque changement de score
    (fin de quiz, ajout de points manuel).
    """
    await ws.accept()
    connexions_ws.add(ws)
    try:
        await ws.send_text(json.dumps({"type": "top10", "top": service.get_top_10_global()}))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        connexions_ws.discard(ws)
