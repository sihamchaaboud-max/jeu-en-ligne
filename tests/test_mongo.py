"""
Tests du service MongoDB

Pré-requis : MongoDB doit être en cours d'exécution (docker-compose up).

Lancer avec :  pytest tests/test_mongo.py -v
"""

import pytest
from app.services.mongo_service import MongoService


@pytest.fixture
def mongo_service():
    """Crée une instance et nettoie la base avant/après les tests."""
    service = MongoService()
    service.joueurs.delete_many({})
    service.inventaires.delete_many({})
    yield service
    service.joueurs.delete_many({})
    service.inventaires.delete_many({})


class TestProfils:
    """Tests des profils joueurs."""

    def test_creer_et_get_profil(self, mongo_service):
        mongo_service.creer_profil("j1", "Oussama", niveau=10)
        profil = mongo_service.get_profil("j1")
        assert profil is not None
        assert profil["nom"] == "Oussama"
        assert profil["niveau"] == 10
        assert profil["xp"] == 0

    def test_get_profil_inexistant(self, mongo_service):
        assert mongo_service.get_profil("j_inexistant") is None

    def test_get_nom(self, mongo_service):
        mongo_service.creer_profil("j1", "Siham")
        assert mongo_service.get_nom("j1") == "Siham"

    def test_get_nom_inexistant(self, mongo_service):
        assert mongo_service.get_nom("j_inexistant") is None

    def test_creer_profil_idempotent(self, mongo_service):
        mongo_service.creer_profil("j1", "Oussama", niveau=1)
        mongo_service.creer_profil("j1", "Oussama2", niveau=5)
        profil = mongo_service.get_profil("j1")
        assert profil["nom"] == "Oussama2"
        assert profil["niveau"] == 5

    def test_update_niveau(self, mongo_service):
        mongo_service.creer_profil("j1", "Oussama", niveau=1)
        mongo_service.update_niveau("j1", 15)
        assert mongo_service.get_profil("j1")["niveau"] == 15

    def test_ajouter_xp(self, mongo_service):
        mongo_service.creer_profil("j1", "Oussama")
        mongo_service.ajouter_xp("j1", 500)
        mongo_service.ajouter_xp("j1", 250)
        assert mongo_service.get_profil("j1")["xp"] == 750


class TestInventaire:
    """Tests des inventaires."""

    def test_ajouter_item_nouvel_inventaire(self, mongo_service):
        mongo_service.ajouter_item("j1", "epee")
        inventaire = mongo_service.get_inventaire("j1")
        assert inventaire == {"epee": 1}

    def test_ajouter_item_quantite(self, mongo_service):
        mongo_service.ajouter_item("j1", "potion", 3)
        assert mongo_service.get_inventaire("j1") == {"potion": 3}

    def test_ajouter_plusieurs_fois_cumule(self, mongo_service):
        mongo_service.ajouter_item("j1", "potion", 2)
        mongo_service.ajouter_item("j1", "potion", 3)
        mongo_service.ajouter_item("j1", "epee", 1)
        inventaire = mongo_service.get_inventaire("j1")
        assert inventaire["potion"] == 5
        assert inventaire["epee"] == 1

    def test_get_inventaire_vide(self, mongo_service):
        assert mongo_service.get_inventaire("j_inexistant") == {}


class TestSuppression:
    """Tests de suppression."""

    def test_supprimer_joueur(self, mongo_service):
        mongo_service.creer_profil("j1", "Oussama")
        mongo_service.ajouter_item("j1", "epee")
        mongo_service.supprimer_joueur("j1")
        assert mongo_service.get_profil("j1") is None
        assert mongo_service.get_inventaire("j1") == {}
