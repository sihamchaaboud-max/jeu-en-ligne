"""
Tests d'intégration — workflows complets via JoueurService.

Contrairement aux tests unitaires qui testent chaque service isolément,
ces tests vérifient que les 3 bases fonctionnent ENSEMBLE correctement.

Pré-requis : toutes les bases doivent tourner (docker compose up -d).
Lancer    : python -m pytest tests/test_integration.py -v
"""

import pytest
from app.joueur_service import JoueurService
from app.services import mongo_service as mongo
from app.services import neo4j_service as neo4j

# IDs réservés aux tests d'intégration (préfixe unique pour éviter les collisions)
ID_A = "integ_alice"
ID_B = "integ_bob"
ID_C = "integ_charlie"


def _purger_historique() -> None:
    """L'historique des parties survit à la suppression du joueur :
    il faut le purger explicitement pour que les tests soient rejouables."""
    mongo.historique_col.delete_many({"joueur_id": {"$in": [ID_A, ID_B, ID_C]}})


@pytest.fixture(autouse=True)
def nettoyage():
    """Supprime les joueurs de test (et leur historique) avant et après chaque test."""
    service = JoueurService()
    for pid in [ID_A, ID_B, ID_C]:
        if mongo.joueur_existe(pid):
            service.supprimer_joueur(pid)
    _purger_historique()
    yield service
    for pid in [ID_A, ID_B, ID_C]:
        if mongo.joueur_existe(pid):
            service.supprimer_joueur(pid)
    _purger_historique()
    # PAS de service.close() ici : il fermerait le driver Neo4j MODULE-level
    # partagé par toute la suite (tests/test_neo4j.py tomberait ensuite).


# ─────────────────────────────────────────────
# 1. creer_joueur() — les 3 bases simultanément
# ─────────────────────────────────────────────

def test_creer_joueur_dans_3_bases(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", niveau=5, score_initial=1000)

    # MongoDB
    profil = mongo.get_profil(ID_A)
    assert profil is not None
    assert profil["pseudo"] == "Alice"
    assert profil["niveau"] == 5

    # Redis
    score = service.redis.get_score(ID_A)
    assert score == 1000

    # Neo4j
    amis = neo4j.get_amis(ID_A)
    assert isinstance(amis, list)   # noeud créé, pas d'erreur


def test_creer_joueur_rollback_si_doublon(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=500)
    # Deuxième création → doit lever une exception (doublon MongoDB)
    with pytest.raises(Exception):
        service.creer_joueur(ID_A, "Alice2", score_initial=999)
    # Le score original est préservé
    assert service.redis.get_score(ID_A) == 500


# ─────────────────────────────────────────────
# 2. get_top_10_global() — Redis + MongoDB
# ─────────────────────────────────────────────

def test_top10_contient_joueur_cree(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=9999)
    top = service.get_top_10_global()

    ids = [e["id"] for e in top]
    assert ID_A in ids

    entree = next(e for e in top if e["id"] == ID_A)
    assert entree["nom"] == "Alice"
    assert entree["score"] == 9999
    assert entree["rang"] >= 1


def test_top10_ordre_decroissant(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice",   score_initial=100)
    service.creer_joueur(ID_B, "Bob",     score_initial=500)
    service.creer_joueur(ID_C, "Charlie", score_initial=300)

    top = service.get_top_10_global()
    # Parmi nos 3 joueurs, l'ordre doit être Bob > Charlie > Alice
    ids_dans_top = [e["id"] for e in top]
    if ID_B in ids_dans_top and ID_C in ids_dans_top:
        assert ids_dans_top.index(ID_B) < ids_dans_top.index(ID_C)
    if ID_C in ids_dans_top and ID_A in ids_dans_top:
        assert ids_dans_top.index(ID_C) < ids_dans_top.index(ID_A)


# ─────────────────────────────────────────────
# 3. get_classement_amis() — Neo4j + Redis + MongoDB
# ─────────────────────────────────────────────

def test_classement_amis_inclut_joueur_et_ses_amis(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice",   score_initial=800)
    service.creer_joueur(ID_B, "Bob",     score_initial=600)
    service.creer_joueur(ID_C, "Charlie", score_initial=400)

    neo4j.ajouter_ami(ID_A, ID_B)
    neo4j.ajouter_ami(ID_A, ID_C)

    classement = service.get_classement_amis(ID_A)

    ids = [e["id"] for e in classement]
    assert ID_A in ids   # le joueur lui-même
    assert ID_B in ids   # ami direct
    assert ID_C in ids   # ami direct


def test_classement_amis_ordre_correct(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=200)
    service.creer_joueur(ID_B, "Bob",   score_initial=800)
    neo4j.ajouter_ami(ID_A, ID_B)

    classement = service.get_classement_amis(ID_A)
    # Bob (800) doit précéder Alice (200)
    ids = [e["id"] for e in classement]
    assert ids.index(ID_B) < ids.index(ID_A)


def test_classement_amis_sans_amis(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=500)
    # Sans amis, le classement ne contient qu'Alice
    classement = service.get_classement_amis(ID_A)
    ids = [e["id"] for e in classement]
    assert ID_A in ids
    assert len(classement) == 1


# ─────────────────────────────────────────────
# 4. supprimer_joueur() — les 3 bases simultanément
# ─────────────────────────────────────────────

def test_supprimer_joueur_des_3_bases(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=1000)
    service.supprimer_joueur(ID_A)

    assert mongo.get_profil(ID_A) is None
    assert service.redis.get_score(ID_A) is None
    # Neo4j : le noeud ne doit plus exister (aucune erreur sur get_amis)
    amis = neo4j.get_amis(ID_A)
    assert amis == []


# ─────────────────────────────────────────────
# 5. Cohérence des scores Redis et rang
# ─────────────────────────────────────────────

def test_increment_score_modifie_rang(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=100)
    service.creer_joueur(ID_B, "Bob",   score_initial=500)

    rang_avant = service.redis.get_rang(ID_A)
    service.redis.increment_score(ID_A, 1000)   # Alice dépasse Bob
    rang_apres = service.redis.get_rang(ID_A)

    assert rang_apres < rang_avant  # rang plus petit = meilleur


# ─────────────────────────────────────────────
# 6. Historique des parties (MongoDB)
# ─────────────────────────────────────────────

def test_historique_enregistre_partie(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=0)

    mongo.enregistrer_partie(ID_A, points=150, duree_secondes=45.3, nb_bonnes=8)
    historique = mongo.get_historique(ID_A)

    assert len(historique) == 1
    assert historique[0]["points"] == 150
    assert historique[0]["bonnes"] == 8


def test_stats_joueur_agregation(nettoyage):
    service = nettoyage
    service.creer_joueur(ID_A, "Alice", score_initial=0)

    mongo.enregistrer_partie(ID_A, points=100, duree_secondes=30, nb_bonnes=5)
    mongo.enregistrer_partie(ID_A, points=200, duree_secondes=40, nb_bonnes=9)

    stats = mongo.get_stats_joueur(ID_A)
    assert stats["nb_parties"]    == 2
    assert stats["meilleur_score"] == 200
    assert stats["score_moyen"]   == 150
    assert stats["total_bonnes"]  == 14
