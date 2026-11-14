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


# ─────────────────────────────────────────────
# Sessions de quiz dans Redis (plus en mémoire)
# ─────────────────────────────────────────────
def test_session_quiz_stockee_dans_redis():
    """La partie doit survivre 'entre deux requêtes' via Redis, pas en mémoire."""
    from app.api import service as svc

    if not mongo.joueur_existe("quiz_test"):
        svc.creer_joueur("quiz_test", "QuizTest", 1, 0)
    try:
        r = client.post("/api/quiz/start", json={"joueur_id": "quiz_test"})
        partie_id = r.json()["partie_id"]
        etat = svc.redis.charger_partie(partie_id)
        assert etat is not None
        assert etat["joueur_id"] == "quiz_test"
        assert etat["question"] is not None
        svc.redis.supprimer_partie(partie_id)
    finally:
        svc.supprimer_joueur("quiz_test")


# ─────────────────────────────────────────────
# Authentification (JWT)
# ─────────────────────────────────────────────
def test_auth_cycle_complet():
    """Définir un mot de passe → login → token → quiz autorisé."""
    from app.api import service as svc

    if not mongo.joueur_existe("quiz_auth"):
        svc.creer_joueur("quiz_auth", "AuthTest", 1, 0)
    try:
        # 1. définir le mot de passe
        r = client.post("/api/auth/mot-de-passe",
                        json={"joueur_id": "quiz_auth", "mot_de_passe": "secret123"})
        assert r.status_code == 200

        # 2. mauvais mot de passe → 401
        r = client.post("/api/auth/login",
                        json={"joueur_id": "quiz_auth", "mot_de_passe": "faux"})
        assert r.status_code == 401

        # 3. bon mot de passe → token
        r = client.post("/api/auth/login",
                        json={"joueur_id": "quiz_auth", "mot_de_passe": "secret123"})
        assert r.status_code == 200
        token = r.json()["token"]
        assert token

        # 4. quiz sans token → 401
        r = client.post("/api/quiz/start", json={"joueur_id": "quiz_auth"})
        assert r.status_code == 401

        # 5. quiz avec token d'un AUTRE joueur → 403
        autre = client.post("/api/auth/login",
                            json={"joueur_id": "quiz_test", "mot_de_passe": "x"})
        # quiz_test n'a pas de mdp ici → on forge un token pour un autre id
        from app import auth_service as auth
        token_autre = auth.creer_token("quiz_autre_joueur")
        r = client.post("/api/quiz/start", json={"joueur_id": "quiz_auth"},
                        headers={"Authorization": f"Bearer {token_autre}"})
        assert r.status_code == 403

        # 6. quiz avec le BON token → 200
        r = client.post("/api/quiz/start", json={"joueur_id": "quiz_auth"},
                        headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["partie_id"]
        svc.redis.supprimer_partie(r.json()["partie_id"])
    finally:
        svc.supprimer_joueur("quiz_auth")


def test_login_joueur_sans_mdp_mode_heritage():
    """Les joueurs du seed (sans mot de passe) restent jouables sans token."""
    if not mongo.joueur_existe("quiz_legacy"):
        service.creer_joueur("quiz_legacy", "Legacy", 1, 0)
    try:
        r = client.post("/api/auth/login",
                        json={"joueur_id": "quiz_legacy", "mot_de_passe": "peu_importe"})
        assert r.status_code == 200
        assert r.json()["token"] is None
        assert r.json()["sans_mot_de_passe"] is True

        r = client.post("/api/quiz/start", json={"joueur_id": "quiz_legacy"})
        assert r.status_code == 200
        service.redis.supprimer_partie(r.json()["partie_id"])
    finally:
        service.supprimer_joueur("quiz_legacy")