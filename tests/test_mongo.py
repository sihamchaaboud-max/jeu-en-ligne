"""Tests MongoDB (Siham). MongoDB doit tourner (docker compose up -d).
Lancer :  python -m pytest tests/test_mongo.py -v
"""
import pytest
from app.services import mongo_service as m

IDS = ["t1", "t2", "t3"]


@pytest.fixture(autouse=True)
def nettoyage():
    for i in IDS:
        m.supprimer_profil(i)
    yield
    for i in IDS:
        m.supprimer_profil(i)


# ---------- profils ----------

def test_creer_et_get_profil():
    m.creer_profil("t1", "Oussama", niveau=10)
    profil = m.get_profil("t1")
    assert profil is not None
    assert profil["pseudo"] == "Oussama"
    assert profil["niveau"] == 10
    assert profil["inventaire"] == []


def test_get_profil_inexistant():
    assert m.get_profil("t_inexistant") is None


def test_get_pseudo():
    m.creer_profil("t1", "Siham")
    assert m.get_pseudo("t1") == "Siham"


def test_get_pseudo_inexistant():
    assert m.get_pseudo("t_inexistant") is None


def test_joueur_existe():
    assert not m.joueur_existe("t1")
    m.creer_profil("t1", "Oussama")
    assert m.joueur_existe("t1")


def test_modifier_niveau():
    m.creer_profil("t1", "Oussama", niveau=1)
    m.modifier_niveau("t1", 15)
    assert m.get_profil("t1")["niveau"] == 15


def test_lister_joueurs():
    m.creer_profil("t1", "A")
    m.creer_profil("t2", "B")
    ids = [j["_id"] for j in m.lister_joueurs()]
    assert "t1" in ids and "t2" in ids


# ---------- inventaire ----------

def test_ajouter_objet_nouvel():
    m.creer_profil("t1", "Oussama")
    m.ajouter_objet("t1", "épée")
    inv = m.get_profil("t1")["inventaire"]
    assert inv == [{"objet": "épée", "qte": 1}]


def test_ajouter_objet_cumul():
    m.creer_profil("t1", "Oussama")
    m.ajouter_objet("t1", "potion", 3)
    m.ajouter_objet("t1", "potion", 2)
    inv = {e["objet"]: e["qte"] for e in m.get_profil("t1")["inventaire"]}
    assert inv["potion"] == 5


def test_retirer_objet():
    m.creer_profil("t1", "Oussama")
    m.ajouter_objet("t1", "potion", 3)
    m.retirer_objet("t1", "potion", 2)
    inv = {e["objet"]: e["qte"] for e in m.get_profil("t1")["inventaire"]}
    assert inv["potion"] == 1


def test_retirer_objet_supprime_si_zero():
    m.creer_profil("t1", "Oussama")
    m.ajouter_objet("t1", "épée", 1)
    m.retirer_objet("t1", "épée", 1)
    inv = m.get_profil("t1")["inventaire"]
    assert inv == []


# ---------- suppression ----------

def test_supprimer_profil():
    m.creer_profil("t1", "Oussama")
    m.supprimer_profil("t1")
    assert m.get_profil("t1") is None
