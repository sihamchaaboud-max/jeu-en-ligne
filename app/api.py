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

  POST /api/demande-ami            → envoyer une demande d'ami
  GET  /api/demandes-ami/{id}      → demandes reçues / envoyées (privé)
  POST /api/demande-ami/accepter   → accepter une demande reçue
  POST /api/demande-ami/refuser    → refuser une demande reçue
  GET  /api/social/{id}            → espace social du joueur connecté (profil + réseau)

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
        {"name": "Système",      "description": "Santé de l'API et des trois bases"},
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
# Santé des trois bases
# ─────────────────────────────────────────────

@app.get(
    "/health",
    tags=["Système"],
    summary="Santé de l'API et des trois bases",
    response_description="État de MongoDB, Redis et Neo4j (200 si tout va bien, 503 sinon)",
)
def health():
    """Ping réel des trois bases — ne se contente pas de vérifier que l'API répond."""
    etat = {"api": "ok", "mongodb": "ok", "redis": "ok", "neo4j": "ok"}
    try:
        mongo.client.admin.command("ping")
    except Exception as e:
        logger.warning("health mongodb : %s", e)
        etat["mongodb"] = "indisponible"
    try:
        service.redis.client.ping()
    except Exception as e:
        logger.warning("health redis : %s", e)
        etat["redis"] = "indisponible"
    try:
        neo4j.verifier_connexion()
    except Exception as e:
        logger.warning("health neo4j : %s", e)
        etat["neo4j"] = "indisponible"

    ok = all(v == "ok" for v in etat.values())
    return JSONResponse(status_code=200 if ok else 503, content=etat)


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


async def diffuser_social(evenement: str, joueurs: list[str], **details) -> None:
    """Prévient en direct les joueurs dont le réseau social vient de changer.

    Le client ne rafraîchit son espace que si son propre id figure dans
    `joueurs` : chacun ne voit donc que les changements qui le concernent
    (invitation reçue, amitié acceptée, etc.).
    """
    await diffuser_evenement(
        {"type": "social", "evenement": evenement, "joueurs": joueurs, **details}
    )


# ─────────────────────────────────────────────
# Modèles Pydantic avec exemples Swagger
# ─────────────────────────────────────────────

class JoueurCreate(BaseModel):
    pseudo:       str = Field(..., example="Alice",  description="Nom affiché")
    niveau:       int = Field(1,   ge=1, le=100, example=1)
    score:        int = Field(0,   ge=0, example=0)
    mot_de_passe: str = Field("",  example="monSecret42", description="Optionnel — active l'authentification")


class AmitiéCreate(BaseModel):
    id_a: str = Field(..., example="oussama-1f3a9c")
    id_b: str = Field(..., example="siham-7d2e10")


class NiveauUpdate(BaseModel):
    niveau: int = Field(..., ge=1, le=100, example=5)


class ObjetAction(BaseModel):
    objet: str = Field(..., example="épée")
    qte:   int = Field(1,  ge=1, example=1)


class DemandeAmiCreate(BaseModel):
    id_de:   str = Field(..., example="siham-7d2e10", description="Demandeur")
    id_vers: str = Field(..., example="oussama-1f3a9c", description="Cible qui devra accepter")


class QuizStart(BaseModel):
    joueur_id: str = Field(..., example="salma-a3f9c1")
    mode:       str = Field("classe", example="classe",
                            description="'classe' (compte au classement) ou 'entrainement' (sans score)")


class QuizAnswer(BaseModel):
    partie_id: str = Field(..., example="a3f9c12d")
    reponse:   str = Field("",  example="42")


class AuthDefinir(BaseModel):
    joueur_id:    str = Field(..., example="salma-a3f9c1")
    mot_de_passe: str = Field(..., min_length=4, example="monSecret42")


class AuthLogin(BaseModel):
    joueur_id:    str = Field(..., example="salma-a3f9c1")
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
def creer_joueur(data: JoueurCreate, authorization: str | None = Header(None)):
    """
    Crée le joueur **simultanément** dans les 3 bases avec rollback de compensation :
    si Neo4j échoue après MongoDB et Redis, les données orphelines sont supprimées.

    L'identifiant est **généré par le serveur** au format « pseudo-suffixe »
    (ex. `salma-a3f9c1`) : il est lisible, unique et non devinable.

    L'inscription est réservée aux visiteurs : une session authentifiée (JWT)
    ne peut pas créer un autre joueur.
    """
    if authorization and authorization.lower().startswith("bearer "):
        raise HTTPException(
            403,
            "Déjà connecté : l'inscription est réservée aux visiteurs non connectés",
        )
    joueur_id = service.generer_id_unique(data.pseudo)
    service.creer_joueur(joueur_id, data.pseudo, data.niveau, data.score,
                         mot_de_passe=data.mot_de_passe)
    return {"message": f"Joueur '{data.pseudo}' créé avec succès", "id": joueur_id}


@app.delete("/api/joueur/{joueur_id}", tags=["Joueurs"], summary="Supprimer un joueur")
def supprimer_joueur(joueur_id: str):
    """Supprime le joueur des **3 bases** (MongoDB + Redis + Neo4j)."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")
    pseudo = mongo.get_pseudo(joueur_id)
    service.supprimer_joueur(joueur_id)
    return {"message": f"Joueur '{pseudo}' supprimé des 3 bases"}


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
# Sécurité des mutations sociales
# ─────────────────────────────────────────────

def _joueur_du_token(authorization: str | None) -> str | None:
    """Extrait l'id du joueur d'un en-tête `Authorization: Bearer <JWT>`."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return auth.lire_token(authorization[len("Bearer "):].strip())


def _autoriser_identite(joueur_id: str, authorization: str | None) -> None:
    """Vérifie que l'appelant agit bien en son propre nom (et non pour autrui).

    Même règle que le quiz (`quiz_start`) :
    - un jeton fourni doit désigner `joueur_id`, sinon 403 (usurpation) ;
    - un compte **protégé par mot de passe** exige son jeton, sinon 401 ;
    - un compte **sans mot de passe** (données de seed, « mode héritage »)
      peut agir sans jeton, comme il peut déjà jouer au quiz.

    Sans cette garde, n'importe qui connaissant un joueur_id pouvait lire sa
    boîte de réception, accepter/refuser ses demandes d'ami ou modifier ses
    amitiés à sa place.
    """
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(404, f"Joueur '{joueur_id}' introuvable")

    porteur = _joueur_du_token(authorization)
    if porteur is not None:
        if porteur != joueur_id:
            raise HTTPException(403, "Ce token ne permet pas d'agir pour ce joueur")
        return

    if mongo.get_mot_de_passe(joueur_id) is not None:
        raise HTTPException(
            401, "Authentification requise : ce joueur est protégé par un mot de passe"
        )


def _autoriser_partie(id_a: str, id_b: str, authorization: str | None) -> None:
    """Vérifie que l'appelant est **l'une des deux parties** d'une relation.

    Utilisé pour retirer une invitation, que ce soit un refus (par le
    destinataire) ou une annulation (par l'expéditeur) : un tiers ne doit
    jamais pouvoir la supprimer. Les règles de jeton sont celles de
    `_autoriser_identite`.
    """
    for pid in (id_a, id_b):
        if not mongo.joueur_existe(pid):
            raise HTTPException(404, f"Joueur '{pid}' introuvable")

    porteur = _joueur_du_token(authorization)
    if porteur is not None:
        if porteur not in (id_a, id_b):
            raise HTTPException(403, "Ce token ne permet pas de modifier cette relation")
        return

    if mongo.get_mot_de_passe(id_a) is not None and mongo.get_mot_de_passe(id_b) is not None:
        raise HTTPException(
            401, "Authentification requise : cette relation oppose deux comptes protégés"
        )


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
def ajouter_ami(
    data: AmitiéCreate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Crée une amitié directe. `id_a` est l'appelant : on ne peut pas
    modifier le réseau d'un autre joueur."""
    _autoriser_identite(data.id_a, authorization)
    if not mongo.joueur_existe(data.id_b):
        raise HTTPException(404, f"Joueur '{data.id_b}' introuvable")
    ok = neo4j.ajouter_ami(data.id_a, data.id_b)
    if not ok:
        raise HTTPException(409, "Ces joueurs sont déjà amis ou IDs invalides")
    pa = mongo.get_pseudo(data.id_a)
    pb = mongo.get_pseudo(data.id_b)
    background_tasks.add_task(
        diffuser_social, "amitie", [data.id_a, data.id_b], par=pa
    )
    return {"message": f"{pa} et {pb} sont maintenant amis"}


@app.delete("/api/ami", tags=["Amitiés"], summary="Supprimer une amitié")
def supprimer_ami(
    data: AmitiéCreate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Retire une amitié. `id_a` est l'appelant (on ne touche pas au réseau d'autrui)."""
    _autoriser_identite(data.id_a, authorization)
    if not mongo.joueur_existe(data.id_b):
        raise HTTPException(404, f"Joueur '{data.id_b}' introuvable")
    ok = neo4j.supprimer_ami(data.id_a, data.id_b)
    if not ok:
        raise HTTPException(404, "Ces joueurs ne sont pas amis")
    background_tasks.add_task(
        diffuser_social, "amitie_retiree", [data.id_a, data.id_b],
        par=mongo.get_pseudo(data.id_a),
    )
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
def envoyer_demande_ami(
    data: DemandeAmiCreate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Crée une relation **en attente** : `id_vers` devra l'accepter.

    `id_de` est l'appelant : on ne peut pas envoyer une demande au nom
    d'un autre joueur, ni s'envoyer une demande à soi-même.
    """
    if data.id_de == data.id_vers:
        raise HTTPException(409, "Impossible de s'envoyer une demande d'ami à soi-même")
    _autoriser_identite(data.id_de, authorization)
    if not mongo.joueur_existe(data.id_vers):
        raise HTTPException(404, f"Joueur '{data.id_vers}' introuvable")

    ok = neo4j.demander_ami(data.id_de, data.id_vers)
    if not ok:
        raise HTTPException(409, "Demande impossible : déjà amis, demande déjà en cours, ou IDs invalides")

    pseudo_de = mongo.get_pseudo(data.id_de)
    pseudo_vers = mongo.get_pseudo(data.id_vers)
    # Le destinataire voit l'invitation apparaître sans recharger la page
    background_tasks.add_task(
        diffuser_social, "demande_recue", [data.id_vers],
        de=data.id_de, de_pseudo=pseudo_de,
    )
    return {"message": f"Demande d'ami envoyée à '{pseudo_vers}'"}


@app.get(
    "/api/demandes-ami/{joueur_id}",
    tags=["Amitiés"],
    summary="Demandes d'ami reçues et envoyées (privé)",
)
def get_demandes_ami(joueur_id: str, authorization: str | None = Header(default=None)):
    """**Neo4j** : relations `AMI_DE` en attente, séparées selon leur sens.

    Boîte de réception privée : seul le joueur lui-même peut la consulter.
    """
    _autoriser_identite(joueur_id, authorization)
    return neo4j.get_demandes(joueur_id)


@app.post("/api/demande-ami/accepter", tags=["Amitiés"], summary="Accepter une demande d'ami")
def accepter_demande_ami(
    data: DemandeAmiCreate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """`id_vers` accepte la demande de `id_de` → la relation devient une amitié.

    Seul le destinataire (`id_vers`) peut accepter : accepter à sa place
    reviendrait à forcer une amitié dans le réseau d'autrui.
    """
    _autoriser_identite(data.id_vers, authorization)
    ok = neo4j.accepter_demande(data.id_de, data.id_vers)
    if not ok:
        raise HTTPException(404, "Aucune demande en attente entre ces joueurs")

    pseudo_de = mongo.get_pseudo(data.id_de)
    pseudo_vers = mongo.get_pseudo(data.id_vers)
    # Les deux réseaux se mettent à jour immédiatement, sans rechargement
    background_tasks.add_task(
        diffuser_social, "ami_accepte", [data.id_de, data.id_vers],
        pseudo=pseudo_vers,
    )
    return {"message": f"{pseudo_de} et {pseudo_vers} sont maintenant amis"}


@app.post("/api/demande-ami/refuser", tags=["Amitiés"], summary="Refuser une demande d'ami")
def refuser_demande_ami(
    data: DemandeAmiCreate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """`id_vers` refuse la demande de `id_de` → la relation en attente est supprimée.

    Couvre aussi l'annulation par l'expéditeur (`id_de`) : dans les deux cas
    l'appelant doit être l'une des deux parties, jamais un tiers.
    """
    _autoriser_partie(data.id_de, data.id_vers, authorization)
    ok = neo4j.refuser_demande(data.id_de, data.id_vers)
    if not ok:
        raise HTTPException(404, "Aucune demande en attente entre ces joueurs")

    background_tasks.add_task(
        diffuser_social, "demande_retiree", [data.id_de, data.id_vers],
        par=mongo.get_pseudo(data.id_vers),
    )
    return {"message": "Demande refusée"}


# ─────────────────────────────────────────────
# Espace social du joueur connecté (profil + réseau)
# ─────────────────────────────────────────────

@app.get(
    "/api/social/{joueur_id}",
    tags=["Amitiés"],
    summary="Espace social privé du joueur connecté",
    response_description="Profil (Mongo + Redis), amis et suggestions (Neo4j), invitations en attente (Neo4j)",
)
def get_espace_social(joueur_id: str, authorization: str | None = Header(default=None)):
    """Une seule requête pour tout l'espace social du joueur : les **3 bases**
    sont lues (MongoDB → profil/inventaire, Redis → score/rang, Neo4j →
    amis, suggestions et invitations).

    Accessible uniquement au joueur lui-même : les invitations en attente et
    les suggestions sont des données privées.
    """
    _autoriser_identite(joueur_id, authorization)

    profil = mongo.get_profil(joueur_id) or {}
    amis = neo4j.get_amis(joueur_id)
    for ami in amis:
        ami["score"] = service.redis.get_score(ami["id"])
        ami["rang"] = service.redis.get_rang(ami["id"])

    # Les suggestions d'amis d'amis excluent déjà les amis directs et toute
    # relation existante (invitation en attente, dans un sens ou l'autre).
    suggestions = neo4j.get_amis_d_amis(joueur_id)
    for s in suggestions:
        s["score"] = service.redis.get_score(s["id"])

    return {
        "profil": {
            "id":         profil.get("_id", joueur_id),
            "pseudo":     profil.get("pseudo", "?"),
            "niveau":     profil.get("niveau", 1),
            "score":      service.redis.get_score(joueur_id),
            "rang":       service.redis.get_rang(joueur_id),
            "inventaire": profil.get("inventaire", []),
            "nb_amis":    len(amis),
        },
        "stats":       mongo.get_stats_joueur(joueur_id),
        "amis":        amis,
        "suggestions": suggestions,
        "demandes":    neo4j.get_demandes(joueur_id),
    }


# ─────────────────────────────────────────────
# Auth — JWT + mots de passe PBKDF2
# ─────────────────────────────────────────────

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
            "pseudo":           mongo.get_pseudo(data.joueur_id),
            "sans_mot_de_passe": True,
            "message":          "Ce joueur n'a pas de mot de passe (mode héritage)",
        }
    if not auth.verifier_mot_de_passe(data.mot_de_passe, stocke):
        raise HTTPException(401, "Mot de passe incorrect")
    return {
        "token":            auth.creer_token(data.joueur_id),
        "joueur_id":        data.joueur_id,
        "pseudo":           mongo.get_pseudo(data.joueur_id),
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
    (fin de quiz).
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
