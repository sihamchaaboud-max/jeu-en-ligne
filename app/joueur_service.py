"""
JoueurService - Intégration (Oussama)

Orchestre les trois services (Mongo, Redis, Neo4j) :
  - creer_joueur()        : crée dans les 3 bases simultanément
  - get_top_10_global()   : Top 10 mondial (Redis + MongoDB)
  - get_classement_amis() : classement entre amis (Neo4j + Redis + MongoDB)
  - supprimer_joueur()    : supprime des 3 bases

Styles des services partenaires :
  - mongo_service  : fonctionnel (Siham)   — fonctions directes
  - redis_service  : classe     (Oussama)  — RedisService
  - neo4j_service  : fonctionnel (Salma)   — fonctions directes
"""

from app.services.redis_service import RedisService
from app.services import mongo_service as mongo
from app.services import neo4j_service as neo4j


class JoueurService:
    """Couche d'intégration : coordonne Mongo, Redis et Neo4j."""

    def __init__(self):
        self.redis = RedisService()
        neo4j.initialiser_schema()

    def close(self):
        neo4j.fermer()

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
        Crée un joueur dans les 3 bases :
          1. MongoDB : profil (pseudo, niveau, inventaire vide)
          2. Redis   : score initial dans le classement global
          3. Neo4j   : noeud Joueur dans le graphe

        Args:
            joueur_id:     identifiant unique (commun aux 3 bases)
            nom:           pseudo affiché
            niveau:        niveau de départ
            score_initial: score de départ (0 par défaut)
        """
        mongo.creer_profil(joueur_id, nom, niveau)
        self.redis.set_score(joueur_id, score_initial)
        neo4j.creer_noeud(joueur_id, nom)

    # ==================================================
    # Top 10 global
    # ==================================================

    def get_top_10_global(self) -> list[dict]:
        """
        Top 10 mondial par score décroissant.
        Combine Redis (scores triés) + MongoDB (pseudos).

        Returns:
            [{"rang": int, "id": str, "nom": str, "score": int}, ...]
        """
        resultats = []
        for i, (joueur_id, score) in enumerate(self.redis.get_top_10()):
            nom = mongo.get_pseudo(joueur_id) or "Inconnu"
            resultats.append({"rang": i + 1, "id": joueur_id, "nom": nom, "score": score})
        return resultats

    # ==================================================
    # Classement entre amis
    # ==================================================

    def get_classement_amis(self, joueur_id: str) -> list[dict]:
        """
        Classement limité aux amis du joueur + lui-même.

        Étapes :
          1. Neo4j  → IDs des amis directs
          2. Redis  → scores triés de cette liste
          3. MongoDB → pseudos pour affichage

        Returns:
            [{"rang": int, "id": str, "nom": str, "score": int}, ...]
        """
        ids = neo4j.get_ids_amis(joueur_id)
        if joueur_id not in ids:
            ids.append(joueur_id)

        resultats = []
        for i, (pid, score) in enumerate(self.redis.get_scores_pour_ids(ids)):
            nom = mongo.get_pseudo(pid) or "Inconnu"
            resultats.append({"rang": i + 1, "id": pid, "nom": nom, "score": score})
        return resultats

    # ==================================================
    # Suppression (intégration 3 bases)
    # ==================================================

    def supprimer_joueur(self, joueur_id: str) -> None:
        """Supprime un joueur des 3 bases."""
        mongo.supprimer_profil(joueur_id)
        self.redis.delete_score(joueur_id)
        neo4j.supprimer_noeud(joueur_id)
