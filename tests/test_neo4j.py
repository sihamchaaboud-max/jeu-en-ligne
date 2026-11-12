"""
Tests du service Neo4j

Pré-requis : Neo4j doit être en cours d'exécution (docker-compose up).

Lancer avec :  pytest tests/test_neo4j.py -v
"""

import pytest
from app.services.neo4j_service import Neo4jService


@pytest.fixture
def neo4j_service():
    """Crée une instance et nettoie le graphe avant/après les tests."""
    service = Neo4jService()
    # nettoyer tous les joueurs de test
    with service.driver.session() as session:
        session.run("MATCH (j:Joueur) DETACH DELETE j")
    yield service
    with service.driver.session() as session:
        session.run("MATCH (j:Joueur) DETACH DELETE j")
    service.close()


class TestNoeudsJoueurs:
    """Tests de création de noeuds joueurs."""

    def test_creer_joueur(self, neo4j_service):
        neo4j_service.creer_joueur("j1", "Oussama")
        amis = neo4j_service.get_amis("j1")
        assert amis == []  # aucun ami au début

    def test_creer_joueur_idempotent(self, neo4j_service):
        neo4j_service.creer_joueur("j1", "Oussama")
        neo4j_service.creer_joueur("j1", "Oussama2")  # mise à jour du nom
        # Ne devrait pas créer de doublon
        with neo4j_service.driver.session() as session:
            result = session.run(
                "MATCH (j:Joueur {id: 'j1'}) RETURN j.nom AS nom"
            )
            records = list(result)
        assert len(records) == 1
        assert records[0]["nom"] == "Oussama2"


class TestAmitie:
    """Tests des relations d'amitié."""

    def test_ajouter_amitie(self, neo4j_service):
        neo4j_service.creer_joueur("j1", "Oussama")
        neo4j_service.creer_joueur("j2", "Siham")
        neo4j_service.ajouter_amitie("j1", "j2")

        amis_j1 = neo4j_service.get_amis("j1")
        amis_j2 = neo4j_service.get_amis("j2")

        assert len(amis_j1) == 1
        assert amis_j1[0]["id"] == "j2"
        assert len(amis_j2) == 1
        assert amis_j2[0]["id"] == "j1"  # bidirectionnel

    def test_get_amis_vide(self, neo4j_service):
        neo4j_service.creer_joueur("j1", "Oussama")
        assert neo4j_service.get_amis("j1") == []

    def test_plusieurs_amis(self, neo4j_service):
        for i, nom in enumerate(["Oussama", "Siham", "Yassine"], 1):
            neo4j_service.creer_joueur(f"j{i}", nom)

        neo4j_service.ajouter_amitie("j1", "j2")
        neo4j_service.ajouter_amitie("j1", "j3")

        amis = neo4j_service.get_amis("j1")
        assert len(amis) == 2


class TestAmisDamis:
    """Tests des amis d'amis (recommandations)."""

    def test_amis_damis_simple(self, neo4j_service):
        """
        Réseau : j1 - j2 - j3
        j3 est ami d'ami de j1 mais pas ami direct.
        """
        neo4j_service.creer_joueur("j1", "Oussama")
        neo4j_service.creer_joueur("j2", "Siham")
        neo4j_service.creer_joueur("j3", "Yassine")

        neo4j_service.ajouter_amitie("j1", "j2")
        neo4j_service.ajouter_amitie("j2", "j3")

        recommandations = neo4j_service.get_amis_damis("j1")
        assert len(recommandations) == 1
        assert recommandations[0]["id"] == "j3"

    def test_amis_damis_exclut_amis_directs(self, neo4j_service):
        """
        j1 - j2, j1 - j3, j2 - j3
        j3 est ami direct de j1, donc ne doit pas apparaître
        dans les amis d'amis.
        """
        for i, nom in enumerate(["Oussama", "Siham", "Yassine"], 1):
            neo4j_service.creer_joueur(f"j{i}", nom)

        neo4j_service.ajouter_amitie("j1", "j2")
        neo4j_service.ajouter_amitie("j1", "j3")
        neo4j_service.ajouter_amitie("j2", "j3")

        recommandations = neo4j_service.get_amis_damis("j1")
        # j3 est ami direct de j1 -> exclu
        # j2 est ami direct de j1 -> exclu
        assert len(recommandations) == 0

    def test_amis_damis_exclut_joueur_lui_meme(self, neo4j_service):
        """
        j1 - j2, j2 - j1 (déjà via bidirectionnel)
        Le joueur lui-même ne doit pas apparaître dans ses amis d'amis.
        """
        neo4j_service.creer_joueur("j1", "Oussama")
        neo4j_service.creer_joueur("j2", "Siham")
        neo4j_service.ajouter_amitie("j1", "j2")

        recommandations = neo4j_service.get_amis_damis("j1")
        # j1 ne doit pas se recommander lui-même
        ids = [r["id"] for r in recommandations]
        assert "j1" not in ids


class TestSuppression:
    """Tests de suppression."""

    def test_supprimer_joueur_supprime_relations(self, neo4j_service):
        neo4j_service.creer_joueur("j1", "Oussama")
        neo4j_service.creer_joueur("j2", "Siham")
        neo4j_service.ajouter_amitie("j1", "j2")

        neo4j_service.supprimer_joueur("j1")

        # j2 ne doit plus avoir j1 comme ami
        amis_j2 = neo4j_service.get_amis("j2")
        assert len(amis_j2) == 0
