"""
Service MongoDB - Personne 1

Responsabilités :
  - Profils des joueurs (nom, niveau, XP)
  - Inventaires des joueurs (items)

Collections utilisées :
  - "joueurs"     : profils des joueurs
  - "inventaires" : items possédés par chaque joueur

NOTE: Ce module est implémenté par l'intégrateur (Oussama) de façon
fonctionnelle. La personne responsable de MongoDB peut l'enrichir.
"""

from pymongo import MongoClient
from app.config import MONGO_URL, MONGO_DB


class MongoService:
    """Couche d'accès à MongoDB pour les profils et inventaires."""

    def __init__(self):
        """Initialise la connexion MongoDB."""
        self.client = MongoClient(MONGO_URL)
        self.db = self.client[MONGO_DB]
        self.joueurs = self.db["joueurs"]
        self.inventaires = self.db["inventaires"]

    # ==================================================
    # Profils joueurs
    # ==================================================

    def creer_profil(self, joueur_id: str, nom: str, niveau: int = 1) -> None:
        """
        Crée le profil d'un joueur.
        Si le joueur existe déjà, ses informations sont mises à jour.

        Args:
            joueur_id: identifiant unique du joueur
            nom:      nom affiché du joueur
            niveau:    niveau de départ (défaut: 1)
        """
        self.joueurs.update_one(
            {"_id": joueur_id},
            {"$set": {"nom": nom, "niveau": niveau, "xp": 0}},
            upsert=True,
        )

    def get_profil(self, joueur_id: str) -> dict | None:
        """
        Récupère le profil complet d'un joueur.

        Returns:
            Le document profil ou None si introuvable.
        """
        return self.joueurs.find_one({"_id": joueur_id})

    def get_nom(self, joueur_id: str) -> str | None:
        """Récupère uniquement le nom d'un joueur."""
        profil = self.joueurs.find_one({"_id": joueur_id})
        return profil["nom"] if profil else None

    def update_niveau(self, joueur_id: str, niveau: int) -> None:
        """Met à jour le niveau d'un joueur."""
        self.joueurs.update_one(
            {"_id": joueur_id}, {"$set": {"niveau": niveau}}
        )

    def ajouter_xp(self, joueur_id: str, xp: int) -> None:
        """Ajoute de l'XP à un joueur."""
        self.joueurs.update_one(
            {"_id": joueur_id}, {"$inc": {"xp": xp}}
        )

    # ==================================================
    # Inventaires
    # ==================================================

    def ajouter_item(self, joueur_id: str, item: str, quantite: int = 1) -> None:
        """
        Ajoute un item à l'inventaire d'un joueur.
        Crée l'inventaire s'il n'existe pas encore.

        Args:
            joueur_id:  identifiant du joueur
            item:       nom de l'item
            quantite:   nombre à ajouter (défaut: 1)
        """
        self.inventaires.update_one(
            {"_id": joueur_id},
            {"$inc": {f"items.{item}": quantite}},
            upsert=True,
        )

    def get_inventaire(self, joueur_id: str) -> dict:
        """
        Récupère l'inventaire d'un joueur.

        Returns:
            Dictionnaire {item: quantite} ou {} si vide.
        """
        doc = self.inventaires.find_one({"_id": joueur_id})
        if doc and "items" in doc:
            return doc["items"]
        return {}

    # ==================================================
    # Suppression
    # ==================================================

    def supprimer_joueur(self, joueur_id: str) -> None:
        """Supprime le profil et l'inventaire d'un joueur."""
        self.joueurs.delete_one({"_id": joueur_id})
        self.inventaires.delete_one({"_id": joueur_id})
