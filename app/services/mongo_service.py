"""MongoDB : profils et inventaires des joueurs (Siham).

Modèle d'un document joueur :
  {
    "_id": "j1",           # clé commune aux 3 bases
    "pseudo": "Oussama",
    "niveau": 10,
    "inventaire": [
      {"objet": "épée",   "qte": 1},
      {"objet": "potion", "qte": 3}
    ]
  }
"""
from pymongo import MongoClient
from app.config import MONGO_URL

client = MongoClient(MONGO_URL)
db = client["jeu_en_ligne"]
joueurs = db["joueurs"]


def creer_profil(player_id: str, pseudo: str, niveau: int = 1, inventaire=None,
                 mot_de_passe: dict | None = None) -> dict:
    """Crée un joueur avec son inventaire. Lève une erreur si l'id existe déjà.

    Args:
        mot_de_passe: hash préparé par auth_service (optionnel)
    """
    joueur = {
        "_id": player_id,
        "pseudo": pseudo,
        "niveau": niveau,
        "inventaire": inventaire or [],
    }
    if mot_de_passe:
        joueur["mot_de_passe"] = mot_de_passe
    joueurs.insert_one(joueur)
    return joueur


def get_profil(player_id: str) -> dict | None:
    """Retourne le joueur complet, ou None s'il n'existe pas."""
    return joueurs.find_one({"_id": player_id})


def get_pseudo(player_id: str) -> str | None:
    """Retourne uniquement le pseudo du joueur (utilisé par l'intégration)."""
    profil = joueurs.find_one({"_id": player_id}, {"pseudo": 1})
    return profil["pseudo"] if profil else None


def get_pseudos(player_ids) -> dict[str, str]:
    """Pseudos de PLUSIEURS joueurs en une seule requête ($in).

    Remplace N appels à get_pseudo() (problème N+1).

    Returns:
        {joueur_id: pseudo} — les ids absents n'apparaissent pas.
    """
    ids = list(player_ids)
    if not ids:
        return {}
    return {
        doc["_id"]: doc["pseudo"]
        for doc in joueurs.find({"_id": {"$in": ids}}, {"pseudo": 1})
    }


def compter_joueurs() -> int:
    """Nombre total de profils (sans charger les documents)."""
    return joueurs.count_documents({})


# ─────────────────────────────────────────────
# Mots de passe (authentification)
# ─────────────────────────────────────────────
def definir_mot_de_passe(player_id: str, stockage: dict) -> None:
    """Range le couple {hash, sel} dans le profil du joueur."""
    joueurs.update_one({"_id": player_id}, {"$set": {"mot_de_passe": stockage}})


def get_mot_de_passe(player_id: str) -> dict | None:
    """Retourne {hash, sel, algo} du joueur, ou None s'il n'en a pas."""
    profil = joueurs.find_one({"_id": player_id}, {"mot_de_passe": 1})
    if profil and profil.get("mot_de_passe"):
        return profil["mot_de_passe"]
    return None


def joueur_existe(player_id: str) -> bool:
    """True si le joueur existe déjà (utile avant de le créer)."""
    return joueurs.count_documents({"_id": player_id}, limit=1) > 0


def lister_joueurs() -> list[dict]:
    """Retourne la liste de tous les joueurs."""
    return list(joueurs.find())


def modifier_niveau(player_id: str, nouveau_niveau: int) -> None:
    """Change le niveau d'un joueur."""
    joueurs.update_one({"_id": player_id}, {"$set": {"niveau": nouveau_niveau}})


def ajouter_objet(player_id: str, objet: str, qte: int = 1) -> None:
    """Ajoute un objet à l'inventaire (ou augmente sa quantité si déjà présent)."""
    resultat = joueurs.update_one(
        {"_id": player_id, "inventaire.objet": objet},
        {"$inc": {"inventaire.$.qte": qte}},
    )
    if resultat.matched_count == 0:
        joueurs.update_one(
            {"_id": player_id},
            {"$push": {"inventaire": {"objet": objet, "qte": qte}}},
        )


def retirer_objet(player_id: str, objet: str, qte: int = 1) -> None:
    """Diminue la quantité d'un objet, et le supprime si elle tombe à 0."""
    joueurs.update_one(
        {"_id": player_id, "inventaire.objet": objet},
        {"$inc": {"inventaire.$.qte": -qte}},
    )
    joueurs.update_one(
        {"_id": player_id},
        {"$pull": {"inventaire": {"qte": {"$lte": 0}}}},
    )


def supprimer_profil(player_id: str) -> None:
    """Supprime le joueur et son inventaire."""
    joueurs.delete_one({"_id": player_id})


# ─────────────────────────────────────────────
# Historique des parties (point 4 — MongoDB)
# ─────────────────────────────────────────────
historique_col = db["historique_parties"]


def enregistrer_partie(player_id: str, points: int, duree_secondes: float, nb_bonnes: int) -> None:
    """Ajoute une entrée dans l'historique des parties d'un joueur.

    Args:
        player_id:        identifiant du joueur
        points:           points gagnés durant cette partie
        duree_secondes:   durée totale de la partie
        nb_bonnes:        nombre de bonnes réponses
    """
    from datetime import datetime, timezone
    historique_col.insert_one({
        "joueur_id": player_id,
        "points":    points,
        "duree":     round(duree_secondes, 1),
        "bonnes":    nb_bonnes,
        "date":      datetime.now(timezone.utc),
    })


def get_historique(player_id: str, limite: int = 10) -> list[dict]:
    """Retourne les dernières parties d'un joueur, de la plus récente à la plus ancienne.

    Args:
        player_id: identifiant du joueur
        limite:    nombre maximum d'entrées à retourner

    Returns:
        Liste de dicts : {points, duree, bonnes, date}
    """
    docs = historique_col.find(
        {"joueur_id": player_id},
        {"_id": 0, "joueur_id": 0},
        sort=[("date", -1)],
        limit=limite,
    )
    result = []
    for d in docs:
        d["date"] = d["date"].isoformat()
        result.append(d)
    return result


def get_stats_joueur(player_id: str) -> dict:
    """Statistiques agrégées : total parties, meilleur score, moyenne.

    Returns:
        {nb_parties, meilleur_score, score_moyen, total_bonnes}
    """
    pipeline = [
        {"$match": {"joueur_id": player_id}},
        {"$group": {
            "_id":          None,
            "nb_parties":   {"$sum": 1},
            "meilleur":     {"$max": "$points"},
            "total_points": {"$sum": "$points"},
            "total_bonnes": {"$sum": "$bonnes"},
        }},
    ]
    rows = list(historique_col.aggregate(pipeline))
    if not rows:
        return {"nb_parties": 0, "meilleur_score": 0, "score_moyen": 0, "total_bonnes": 0}
    r = rows[0]
    return {
        "nb_parties":    r["nb_parties"],
        "meilleur_score": r["meilleur"],
        "score_moyen":   round(r["total_points"] / r["nb_parties"]),
        "total_bonnes":  r["total_bonnes"],
    }
