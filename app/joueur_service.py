"""
JoueurService - Intégration (Oussama)

Ce module orchestre les trois services (Mongo, Redis, Neo4j)
pour offrir une logique métier unifiée :

  - creer_joueur()       : crée un joueur dans les 3 bases
  - get_top_10_global()  : Top 10 des scores mondiaux
  - get_classement_amis(): classement limité aux amis + le joueur
  - supprimer_joueur()   : supprime des 3 bases

C'est le point d'entrée unique pour les opérations qui touchent
plusieurs bases de données simultanément.
"""

from app.services.mongo_service import MongoService
from app.services.redis_service import RedisService
from app.services.neo4j_service import Neo4jService


class JoueurService:
    """Couche d'intégration : coordonne Mongo, Redis et Neo4j."""

    def __init__(self):
        """Initialise les connexions aux trois bases."""
        self.mongo = MongoService()
        self.redis = RedisService()
        self.neo4j = Neo4jService()

    def close(self):
        """Ferme les connexions ouvertes."""
        self.neo4j.close()

    # ==================================================
    # Création de joueur (intégration 3 bases)
    # ==================================================

    def creer_joueur(
        self,
        joueur_id: str,
        nom: str,
        niveau: int = 1,
        score_initial: int = 0,
    ) -> None:
        """
        Crée un joueur complet dans les trois bases :
          1. MongoDB : profil + inventaire vide
          2. Redis   : score initial dans le classement
          3. Neo4j   : noeud Joueur dans le graphe

        Args:
            joueur_id:     identifiant unique du joueur
            nom:           nom affiché
            niveau:        niveau de départ
            score_initial: score de départ (0 par défaut)
        """
        # 1. MongoDB : profil
        self.mongo.creer_profil(joueur_id, nom, niveau)

        # 2. Redis : score
        self.redis.set_score(joueur_id, score_initial)

        # 3. Neo4j : noeud
        self.neo4j.creer_joueur(joueur_id, nom)

    # ==================================================
    # Top 10 global
    # ==================================================

    def get_top_10_global(self) -> list[dict]:
        """
        Récupère le Top 10 mondial des joueurs par score.
        Combine Redis (scores) et MongoDB (noms des joueurs).

        Returns:
            Liste de dictionnaires triés par rang :
            {"rang": int, "id": str, "nom": str, "score": int}
        """
        top_scores = self.redis.get_top_10()

        resultats = []
        for i, (joueur_id, score) in enumerate(top_scores):
            nom = self.mongo.get_nom(joueur_id) or "Inconnu"
            resultats.append(
                {"rang": i + 1, "id": joueur_id, "nom": nom, "score": score}
            )
        return resultats

    # ==================================================
    # Classement entre amis
    # ==================================================

    def get_classement_amis(self, joueur_id: str) -> list[dict]:
        """
        Classement limité aux amis du joueur + le joueur lui-même.
        Combine Neo4j (liste d'amis) et Redis (scores).

        Étapes :
          1. Récupérer les amis directs depuis Neo4j
          2. Ajouter le joueur lui-même à la liste
          3. Demander à Redis les scores de tous ces joueurs
          4. Enrichir avec les noms depuis MongoDB

        Args:
            joueur_id: identifiant du joueur

        Returns:
            Liste de dictionnaires triés par rang :
            {"rang": int, "id": str, "nom": str, "score": int}
        """
        # 1. Amis depuis Neo4j
        amis = self.neo4j.get_amis(joueur_id)
        ids_a_classer = [a["id"] for a in amis]

        # 2. Ajouter le joueur lui-même
        if joueur_id not in ids_a_classer:
            ids_a_classer.append(joueur_id)

        # 3. Scores depuis Redis (triés par score décroissant)
        scores_tries = self.redis.get_scores_pour_ids(ids_a_classer)

        # 4. Enrichir avec les noms depuis MongoDB
        resultats = []
        for i, (pid, score) in enumerate(scores_tries):
            nom = self.mongo.get_nom(pid) or "Inconnu"
            resultats.append(
                {"rang": i + 1, "id": pid, "nom": nom, "score": score}
            )
        return resultats

    # ==================================================
    # Suppression (intégration 3 bases)
    # ==================================================

    def supprimer_joueur(self, joueur_id: str) -> None:
        """Supprime un joueur des trois bases."""
        self.mongo.supprimer_joueur(joueur_id)
        self.redis.delete_score(joueur_id)
        self.neo4j.supprimer_joueur(joueur_id)
