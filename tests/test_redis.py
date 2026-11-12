"""
Tests du service Redis (module d'Oussama)

Pré-requis : Redis doit être en cours d'exécution (docker-compose up).

Lancer avec :  pytest tests/test_redis.py -v
"""

import pytest
from app.services.redis_service import RedisService


@pytest.fixture
def redis_service():
    """Crée une instance du service Redis et nettoie avant/après."""
    service = RedisService()
    service.clear()  # nettoyer avant les tests
    yield service
    service.clear()  # nettoyer après les tests


class TestScores:
    """Tests de la gestion des scores."""

    def test_set_et_get_score(self, redis_service):
        redis_service.set_score("j1", 1000)
        assert redis_service.get_score("j1") == 1000

    def test_get_score_inexistant(self, redis_service):
        assert redis_service.get_score("joueur_inexistant") is None

    def test_update_score(self, redis_service):
        redis_service.set_score("j1", 500)
        redis_service.set_score("j1", 1500)  # mise à jour
        assert redis_service.get_score("j1") == 1500

    def test_increment_score(self, redis_service):
        redis_service.set_score("j1", 1000)
        nouveau = redis_service.increment_score("j1", 500)
        assert nouveau == 1500

    def test_increment_score_joueur_inexistant(self, redis_service):
        """Un joueur sans score commence à 0 puis reçoit les points."""
        nouveau = redis_service.increment_score("j9", 300)
        assert nouveau == 300

    def test_delete_score(self, redis_service):
        redis_service.set_score("j1", 1000)
        redis_service.delete_score("j1")
        assert redis_service.get_score("j1") is None


class TestTop10:
    """Tests du Top 10 global."""

    def test_top_10_ordre_decroissant(self, redis_service):
        redis_service.set_score("j1", 100)
        redis_service.set_score("j2", 500)
        redis_service.set_score("j3", 300)

        top = redis_service.get_top_10()
        assert len(top) == 3
        # Ordre décroissant : j2 (500), j3 (300), j1 (100)
        assert top[0] == ("j2", 500)
        assert top[1] == ("j3", 300)
        assert top[2] == ("j1", 100)

    def test_top_10_limite_a_10(self, redis_service):
        for i in range(15):
            redis_service.set_score(f"j{i}", i * 100)

        top = redis_service.get_top_10()
        assert len(top) == 10

    def test_top_10_vide(self, redis_service):
        top = redis_service.get_top_10()
        assert top == []

    def test_get_rang(self, redis_service):
        redis_service.set_score("j1", 100)
        redis_service.set_score("j2", 500)
        redis_service.set_score("j3", 300)

        assert redis_service.get_rang("j2") == 1  # meilleur
        assert redis_service.get_rang("j3") == 2
        assert redis_service.get_rang("j1") == 3  # dernier

    def test_get_rang_inexistant(self, redis_service):
        assert redis_service.get_rang("joueur_inexistant") is None

    def test_get_nombre_joueurs(self, redis_service):
        redis_service.set_score("j1", 100)
        redis_service.set_score("j2", 200)
        redis_service.set_score("j3", 300)
        assert redis_service.get_nombre_joueurs() == 3


class TestClassementAmis:
    """Tests du classement entre amis (scores pour une liste d'IDs)."""

    def test_get_scores_pour_ids(self, redis_service):
        redis_service.set_score("j1", 100)
        redis_service.set_score("j2", 500)
        redis_service.set_score("j3", 300)

        resultats = redis_service.get_scores_pour_ids(["j1", "j2", "j3"])
        assert len(resultats) == 3
        assert resultats[0] == ("j2", 500)
        assert resultats[1] == ("j3", 300)
        assert resultats[2] == ("j1", 100)

    def test_get_scores_pour_ids_ignore_sans_score(self, redis_service):
        redis_service.set_score("j1", 100)
        # j2 n'a pas de score

        resultats = redis_service.get_scores_pour_ids(["j1", "j2"])
        assert len(resultats) == 1
        assert resultats[0] == ("j1", 100)

    def test_get_scores_pour_ids_liste_vide(self, redis_service):
        resultats = redis_service.get_scores_pour_ids([])
        assert resultats == []
