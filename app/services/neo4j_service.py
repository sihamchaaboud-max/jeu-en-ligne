"""
Service Neo4j - Personne 3

Responsabilités :
  - Gérer les relations d'amitié entre joueurs
  - Lister les amis directs d'un joueur
  - Lister les amis d'amis (recommandations)

Structure du graphe :
  - Noeuds  : (:Joueur {id, nom})
  - Relations : (j1)-[:AMI]->(j2)  (bidirectionnelle)

NOTE: Ce module est implémenté par l'intégrateur (Oussama) de façon
fonctionnelle. La personne responsable de Neo4j peut l'enrichir.
"""

from neo4j import GraphDatabase
from app.config import NEO4J_URL, NEO4J_USER, NEO4J_PASSWORD


class Neo4jService:
    """Couche d'accès à Neo4j pour la gestion des amitiés."""

    def __init__(self):
        """Initialise la connexion Neo4j."""
        self.driver = GraphDatabase.driver(
            NEO4J_URL, auth=(NEO4J_USER, NEO4J_PASSWORD)
        )

    def close(self):
        """Ferme la connexion."""
        self.driver.close()

    # ==================================================
    # Création de noeuds
    # ==================================================

    def creer_joueur(self, joueur_id: str, nom: str) -> None:
        """
        Crée un noeud Joueur dans le graphe.
        Si le noeud existe déjà, le nom est mis à jour.

        Args:
            joueur_id: identifiant unique du joueur
            nom:       nom affiché du joueur
        """
        with self.driver.session() as session:
            session.run(
                "MERGE (j:Joueur {id: $id}) SET j.nom = $nom",
                id=joueur_id,
                nom=nom,
            )

    # ==================================================
    # Amitiés
    # ==================================================

    def ajouter_amitie(self, joueur_id: str, ami_id: str) -> None:
        """
        Ajoute une relation d'amitié bidirectionnelle entre deux joueurs.
        Les deux joueurs doivent déjà exister comme noeuds.

        Args:
            joueur_id: identifiant du joueur
            ami_id:    identifiant de l'ami à ajouter
        """
        with self.driver.session() as session:
            session.run(
                """
                MATCH (j1:Joueur {id: $joueur_id}), (j2:Joueur {id: $ami_id})
                MERGE (j1)-[:AMI]->(j2)
                MERGE (j2)-[:AMI]->(j1)
                """,
                joueur_id=joueur_id,
                ami_id=ami_id,
            )

    def get_amis(self, joueur_id: str) -> list[dict]:
        """
        Récupère la liste des amis directs d'un joueur.

        Returns:
            Liste de dictionnaires {"id": ..., "nom": ...}.
        """
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (j:Joueur {id: $joueur_id})-[:AMI]->(ami:Joueur)
                RETURN ami.id AS id, ami.nom AS nom
                """,
                joueur_id=joueur_id,
            )
            return [{"id": r["id"], "nom": r["nom"]} for r in result]

    def get_amis_damis(self, joueur_id: str) -> list[dict]:
        """
        Récupère les amis d'amis qui ne sont pas déjà des amis directs
        ni le joueur lui-même. Utile pour les recommandations d'amis.

        Returns:
            Liste de dictionnaires {"id": ..., "nom": ...}.
        """
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (j:Joueur {id: $joueur_id})-[:AMI]->(:Joueur)-[:AMI]->(amidami:Joueur)
                WHERE amidami.id <> $joueur_id
                  AND NOT (j)-[:AMI]->(amidami)
                RETURN DISTINCT amidami.id AS id, amidami.nom AS nom
                """,
                joueur_id=joueur_id,
            )
            return [{"id": r["id"], "nom": r["nom"]} for r in result]

    # ==================================================
    # Suppression
    # ==================================================

    def supprimer_joueur(self, joueur_id: str) -> None:
        """Supprime un joueur et toutes ses relations du graphe."""
        with self.driver.session() as session:
            session.run(
                "MATCH (j:Joueur {id: $id}) DETACH DELETE j",
                id=joueur_id,
            )
