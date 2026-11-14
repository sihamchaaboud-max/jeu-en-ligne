"""
API REST — FastAPI

Expose toutes les fonctionnalités du jeu via HTTP :
  GET  /                          → sert le frontend (index.html)
  GET  /api/top10                 → Top 10 global
  GET  /api/joueurs               → liste tous les joueurs
  GET  /api/joueur/{id}           → profil complet d'un joueur
  POST /api/joueur                → créer un joueur
  DELETE /api/joueur/{id}         → supprimer un joueur
  GET  /api/classement-amis/{id}  → classement entre amis
  GET  /api/amis/{id}             → amis directs
  GET  /api/amis-damis/{id}       → recommandations
  POST /api/ami                   → ajouter une amitié
  DELETE /api/ami                 → supprimer une amitié
  PUT  /api/score/{id}            → ajouter des points
  PUT  /api/niveau/{id}           → modifier le niveau
  POST /api/objet/{id}            → ajouter un objet
  DELETE /api/objet/{id}          → retirer un objet
  GET  /api/stats                 → statistiques globales

Lancer avec :
    python -m uvicorn app.api:app --reload --port 8000
"""

import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.joueur_service import JoueurService
from app.quiz_service import Partie, NB_QUESTIONS, TEMPS_LIMITE
from app.services import mongo_service as mongo
from app.services import neo4j_service as neo4j

# ─────────────────────────────────────────────
# App FastAPI
# ─────────────────────────────────────────────
app = FastAPI(
    title="Jeu en Ligne — API",
    description="API NoSQL : MongoDB + Redis + Neo4j",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sert les fichiers statiques (CSS, JS, images)
STATIC_DIR = Path(__file__).parent.parent / "frontend" / "static"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Service partagé (connexions ouvertes une seule fois)
service = JoueurService()


# ─────────────────────────────────────────────
# Modèles Pydantic (validation des données)
# ─────────────────────────────────────────────
class JoueurCreate(BaseModel):
    id: str
    pseudo: str
    niveau: int = 1
    score: int = 0


class AmitiéCreate(BaseModel):
    id_a: str
    id_b: str


class ScoreUpdate(BaseModel):
    points: int


class NiveauUpdate(BaseModel):
    niveau: int


class ObjetAction(BaseModel):
    objet: str
    qte: int = 1


class QuizStart(BaseModel):
    joueur_id: str


class QuizAnswer(BaseModel):
    partie_id: str
    reponse: str = ""


# ─────────────────────────────────────────────
# Frontend
# ─────────────────────────────────────────────
@app.get("/", include_in_schema=False)
def root():
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "Frontend non trouvé. Lance le backend et ouvre frontend/index.html"}


# ─────────────────────────────────────────────
# API — Classements
# ─────────────────────────────────────────────
@app.get("/api/top10", tags=["Classements"])
def get_top10():
    """Top 10 global par score décroissant."""
    return service.get_top_10_global()


@app.get("/api/classement-amis/{joueur_id}", tags=["Classements"])
def get_classement_amis(joueur_id: str):
    """Classement limité aux amis du joueur + lui-même."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    return service.get_classement_amis(joueur_id)


@app.get("/api/stats", tags=["Classements"])
def get_stats():
    """Statistiques globales du jeu."""
    total_redis = service.redis.get_nombre_joueurs()
    total_mongo = len(mongo.lister_joueurs())
    top1 = service.get_top_10_global()
    return {
        "joueurs_classes": total_redis,
        "joueurs_total": total_mongo,
        "leader": top1[0] if top1 else None,
    }


# ─────────────────────────────────────────────
# API — Joueurs
# ─────────────────────────────────────────────
@app.get("/api/joueurs", tags=["Joueurs"])
def get_joueurs():
    """Liste tous les joueurs avec leur score Redis."""
    joueurs = mongo.lister_joueurs()
    result = []
    for j in joueurs:
        score = service.redis.get_score(j["_id"])
        rang  = service.redis.get_rang(j["_id"])
        result.append({
            "id":       j["_id"],
            "pseudo":   j.get("pseudo", "?"),
            "niveau":   j.get("niveau", 1),
            "score":    score,
            "rang":     rang,
            "inventaire": j.get("inventaire", []),
        })
    result.sort(key=lambda x: x["score"] or 0, reverse=True)
    return result


@app.get("/api/joueur/{joueur_id}", tags=["Joueurs"])
def get_joueur(joueur_id: str):
    """Profil complet d'un joueur (Mongo + Redis + Neo4j)."""
    profil = mongo.get_profil(joueur_id)
    if not profil:
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")

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


@app.post("/api/joueur", status_code=201, tags=["Joueurs"])
def creer_joueur(data: JoueurCreate):
    """Crée un joueur dans les 3 bases."""
    if mongo.joueur_existe(data.id):
        raise HTTPException(status_code=409, detail=f"Le joueur '{data.id}' existe déjà")
    service.creer_joueur(data.id, data.pseudo, data.niveau, data.score)
    return {"message": f"Joueur '{data.pseudo}' créé avec succès", "id": data.id}


@app.delete("/api/joueur/{joueur_id}", tags=["Joueurs"])
def supprimer_joueur(joueur_id: str):
    """Supprime un joueur des 3 bases."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    pseudo = mongo.get_pseudo(joueur_id)
    service.supprimer_joueur(joueur_id)
    return {"message": f"Joueur '{pseudo}' supprimé des 3 bases"}


@app.put("/api/score/{joueur_id}", tags=["Joueurs"])
def update_score(joueur_id: str, data: ScoreUpdate):
    """Ajoute (ou retire) des points à un joueur."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    nouveau = service.redis.increment_score(joueur_id, data.points)
    rang    = service.redis.get_rang(joueur_id)
    return {"joueur_id": joueur_id, "nouveau_score": int(nouveau), "rang": rang}


@app.put("/api/niveau/{joueur_id}", tags=["Joueurs"])
def update_niveau(joueur_id: str, data: NiveauUpdate):
    """Modifie le niveau d'un joueur."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    mongo.modifier_niveau(joueur_id, data.niveau)
    return {"joueur_id": joueur_id, "nouveau_niveau": data.niveau}


# ─────────────────────────────────────────────
# API — Inventaire
# ─────────────────────────────────────────────
@app.post("/api/objet/{joueur_id}", tags=["Inventaire"])
def ajouter_objet(joueur_id: str, data: ObjetAction):
    """Ajoute un objet à l'inventaire."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    mongo.ajouter_objet(joueur_id, data.objet, data.qte)
    return {"message": f"{data.qte}x {data.objet} ajouté"}


@app.delete("/api/objet/{joueur_id}", tags=["Inventaire"])
def retirer_objet(joueur_id: str, data: ObjetAction):
    """Retire un objet de l'inventaire."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    mongo.retirer_objet(joueur_id, data.objet, data.qte)
    return {"message": f"{data.qte}x {data.objet} retiré"}


# ─────────────────────────────────────────────
# API — Amitiés
# ─────────────────────────────────────────────
@app.get("/api/amis/{joueur_id}", tags=["Amitiés"])
def get_amis(joueur_id: str):
    """Amis directs d'un joueur."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    amis = neo4j.get_amis(joueur_id)
    # Enrichir avec les scores Redis
    for ami in amis:
        ami["score"] = service.redis.get_score(ami["id"])
        ami["rang"]  = service.redis.get_rang(ami["id"])
    return amis


@app.get("/api/amis-damis/{joueur_id}", tags=["Amitiés"])
def get_amis_damis(joueur_id: str):
    """Recommandations d'amis (amis d'amis)."""
    if not mongo.joueur_existe(joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{joueur_id}' introuvable")
    return neo4j.get_amis_d_amis(joueur_id)


@app.post("/api/ami", status_code=201, tags=["Amitiés"])
def ajouter_ami(data: AmitiéCreate):
    """Crée une relation d'amitié."""
    for pid in [data.id_a, data.id_b]:
        if not mongo.joueur_existe(pid):
            raise HTTPException(status_code=404, detail=f"Joueur '{pid}' introuvable")
    ok = neo4j.ajouter_ami(data.id_a, data.id_b)
    if not ok:
        raise HTTPException(status_code=409, detail="Ces joueurs sont déjà amis ou IDs invalides")
    pa = mongo.get_pseudo(data.id_a)
    pb = mongo.get_pseudo(data.id_b)
    return {"message": f"{pa} et {pb} sont maintenant amis"}


@app.delete("/api/ami", tags=["Amitiés"])
def supprimer_ami(data: AmitiéCreate):
    """Supprime une relation d'amitié."""
    ok = neo4j.supprimer_ami(data.id_a, data.id_b)
    if not ok:
        raise HTTPException(status_code=404, detail="Ces joueurs ne sont pas amis")
    return {"message": "Amitié supprimée"}


# ─────────────────────────────────────────────────────────────
# API — Quiz (calcul mental, score ajouté dans Redis)
# ─────────────────────────────────────────────────────────────
parties_quiz: dict[str, Partie] = {}   # partie_id -> partie en cours


@app.post("/api/quiz/start", tags=["Quiz"])
def quiz_start(data: QuizStart):
    """Démarre une partie de quiz pour un joueur existant."""
    if not mongo.joueur_existe(data.joueur_id):
        raise HTTPException(status_code=404, detail=f"Joueur '{data.joueur_id}' introuvable")

    partie = Partie(data.joueur_id)
    question = partie.question_suivante()

    partie_id = uuid.uuid4().hex[:12]
    parties_quiz[partie_id] = partie

    return {
        "partie_id": partie_id,
        "pseudo": mongo.get_pseudo(data.joueur_id),
        "nb_questions": NB_QUESTIONS,
        "temps_limite": TEMPS_LIMITE,
        "numero": 1,
        "question": question,
    }


@app.post("/api/quiz/answer", tags=["Quiz"])
def quiz_answer(data: QuizAnswer):
    """Vérifie une réponse. Les points gagnés sont ajoutés au score Redis."""
    partie = parties_quiz.get(data.partie_id)
    if partie is None or partie.question is None:
        raise HTTPException(status_code=404, detail="Partie de quiz introuvable ou déjà terminée")

    resultat = partie.repondre(data.reponse)
    if resultat["correct"]:
        service.redis.increment_score(partie.joueur_id, resultat["points"])

    reponse = {
        **resultat,
        "score_partie": partie.score,
        "termine": partie.terminee,
    }

    if partie.terminee:
        reponse["nouveau_score"] = int(service.redis.get_score(partie.joueur_id) or 0)
        reponse["rang"] = service.redis.get_rang(partie.joueur_id)
        parties_quiz.pop(data.partie_id, None)   # nettoyage
    else:
        reponse["numero"] = partie.numero
        reponse["question"] = partie.question_suivante()

    return reponse


# ─────────────────────────────────────────────────────────────
# Frontend — page quiz autonome
# ─────────────────────────────────────────────────────────────
@app.get("/quiz", include_in_schema=False)
def quiz_page():
    page = FRONTEND_DIR / "quiz.html"
    if page.exists():
        return FileResponse(str(page))
    raise HTTPException(status_code=404, detail="Quiz non trouvé")
