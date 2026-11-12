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


def creer_profil(player_id: str, pseudo: str, niveau: int = 1, inventaire=None) -> dict:
    """Crée un joueur avec son inventaire. Lève une erreur si l'id existe déjà."""
    joueur = {
        "_id": player_id,
        "pseudo": pseudo,
        "niveau": niveau,
        "inventaire": inventaire or [],
    }
    joueurs.insert_one(joueur)
    return joueur


def get_profil(player_id: str) -> dict | None:
    """Retourne le joueur complet, ou None s'il n'existe pas."""
    return joueurs.find_one({"_id": player_id})


def get_pseudo(player_id: str) -> str | None:
    """Retourne uniquement le pseudo du joueur (utilisé par l'intégration)."""
    profil = joueurs.find_one({"_id": player_id}, {"pseudo": 1})
    return profil["pseudo"] if profil else None


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
