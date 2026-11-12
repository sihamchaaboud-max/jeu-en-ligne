from pymongo import MongoClient
from app.config import MONGO_URL

# 1. Connexion au serveur MongoDB
client = MongoClient(MONGO_URL)

# 2. Choix de la base et de la collection (créées automatiquement)
db = client["jeu_en_ligne"]
joueurs = db["joueurs"]


def creer_profil(player_id, pseudo, niveau=1, inventaire=None):
    """Crée un joueur avec son inventaire."""
    joueur = {
        "_id": player_id,          # clé commune aux 3 bases
        "pseudo": pseudo,
        "niveau": niveau,
        "inventaire": inventaire or [],
    }
    joueurs.insert_one(joueur)
    return joueur


def get_profil(player_id):
    """Retourne le joueur, ou None s'il n'existe pas."""
    return joueurs.find_one({"_id": player_id})


def ajouter_objet(player_id, objet, qte=1):
    """Ajoute un objet à l'inventaire (ou augmente sa quantité)."""
    # Si l'objet existe déjà, on augmente la quantité
    resultat = joueurs.update_one(
        {"_id": player_id, "inventaire.objet": objet},
        {"$inc": {"inventaire.$.qte": qte}},
    )
    # Sinon, on l'ajoute à la liste
    if resultat.matched_count == 0:
        joueurs.update_one(
            {"_id": player_id},
            {"$push": {"inventaire": {"objet": objet, "qte": qte}}},
        )


def supprimer_profil(player_id):
    joueurs.delete_one({"_id": player_id})

def lister_joueurs():
    """Retourne la liste de tous les joueurs."""
    return list(joueurs.find())


def joueur_existe(player_id):
    """True si le joueur existe déjà (utile avant de le créer)."""
    return joueurs.count_documents({"_id": player_id}, limit=1) > 0


def modifier_niveau(player_id, nouveau_niveau):
    """Change le niveau d'un joueur."""
    joueurs.update_one(
        {"_id": player_id},
        {"$set": {"niveau": nouveau_niveau}},
    )


def retirer_objet(player_id, objet, qte=1):
    """Utilise un objet : diminue la quantité, et le supprime si elle tombe à 0."""
    joueurs.update_one(
        {"_id": player_id, "inventaire.objet": objet},
        {"$inc": {"inventaire.$.qte": -qte}},
    )
    # On enlève de la liste les objets dont la quantité est <= 0
    joueurs.update_one(
        {"_id": player_id},
        {"$pull": {"inventaire": {"qte": {"$lte": 0}}}},
    )