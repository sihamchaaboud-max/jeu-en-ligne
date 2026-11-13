import time
from app.quiz_service import (
    generer_question, verifier_reponse, calculer_points, Partie, NB_QUESTIONS
)


def test_generer_question_a_une_reponse_entiere():
    for _ in range(100):
        q = generer_question()
        assert isinstance(q["reponse"], int)
        assert q["reponse"] >= 0


def test_verifier_reponse():
    q = {"texte": "2 + 3", "reponse": 5}
    assert verifier_reponse(q, "5") is True
    assert verifier_reponse(q, "6") is False
    assert verifier_reponse(q, "abc") is False


def test_points_selon_rapidite():
    assert calculer_points(True, 0) == 20
    assert calculer_points(True, 3) == 17
    assert calculer_points(True, 9.5) == 10
    assert calculer_points(True, 11) == 0      # trop lent
    assert calculer_points(False, 1) == 0      # mauvaise réponse


def test_partie_complete():
    partie = Partie("j1")
    for _ in range(NB_QUESTIONS):
        assert partie.question_suivante() is not None
        partie.repondre(str(partie.question["reponse"]))
    assert partie.terminee
    assert partie.question_suivante() is None
    assert partie.score > 0


def test_partie_temps_mesure():
    partie = Partie("j1")
    partie.question_suivante()
    partie.heure_question = time.time() - 2    # on simule 2 secondes écoulées
    resultat = partie.repondre(str(partie.question["reponse"]))
    assert resultat["correct"] is True
    assert resultat["points"] in (17, 18)