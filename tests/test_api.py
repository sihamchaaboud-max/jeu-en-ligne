from fastapi.testclient import TestClient

from app.api import app, service
from app.services import mongo_service as mongo

client = TestClient(app)


def calculer(texte):
    """Résout une question comme '3 × 4' (le test joue à la place du joueur)."""
    a, op, b = texte.split()
    a, b = int(a), int(b)
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    return a * b


def test_joueur_inconnu():
    r = client.post("/api/quiz/start", json={"joueur_id": "inconnu_xyz"})
    assert r.status_code == 404


def test_partie_complete_met_a_jour_redis():
    if not mongo.joueur_existe("quiz_test"):
        service.creer_joueur("quiz_test", "QuizTest", 1, 0)
    try:
        r = client.post("/api/quiz/start", json={"joueur_id": "quiz_test"})
        assert r.status_code == 200
        data = r.json()
        partie_id, question = data["partie_id"], data["question"]

        while True:
            r = client.post(
                "/api/quiz/answer",
                json={"partie_id": partie_id, "reponse": str(calculer(question))},
            )
            resultat = r.json()
            assert resultat["correct"] is True
            if resultat["termine"]:
                break
            question = resultat["question"]

        assert resultat["nouveau_score"] > 0
        assert service.redis.get_score("quiz_test") > 0
    finally:
        service.supprimer_joueur("quiz_test")


def test_partie_inexistante():
    r = client.post("/api/quiz/answer", json={"partie_id": "n_existe_pas", "reponse": "1"})
    assert r.status_code == 404