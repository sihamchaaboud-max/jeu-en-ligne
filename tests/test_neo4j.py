"""Tests Neo4j. Neo4j doit tourner (docker compose up -d neo4j).
Lancer :  python -m pytest tests/test_neo4j.py -v
Graphe de test :  a-b, b-c, b-d, c-e"""
import pytest
from app.services import neo4j_service as neo

IDS = ["t_a", "t_b", "t_c", "t_d", "t_e"]


@pytest.fixture(autouse=True)
def graphe():
    neo.initialiser_schema()
    for i in IDS:
        neo.supprimer_noeud(i)
        neo.creer_noeud(i, f"pseudo_{i}")
    for x, y in [("t_a", "t_b"), ("t_b", "t_c"), ("t_b", "t_d"), ("t_c", "t_e")]:
        neo.ajouter_ami(x, y)
    yield
    for i in IDS:
        neo.supprimer_noeud(i)


def test_get_amis():
    assert [a["id"] for a in neo.get_amis("t_b")] == ["t_a", "t_c", "t_d"]


def test_amitie_symetrique():
    assert neo.sont_amis("t_a", "t_b") and neo.sont_amis("t_b", "t_a")


def test_ajouter_ami_sans_doublon():
    neo.ajouter_ami("t_a", "t_b")
    neo.ajouter_ami("t_b", "t_a")          # dans l'autre sens
    assert len(neo.get_amis("t_a")) == 1


def test_pas_ami_avec_soi_meme():
    assert neo.ajouter_ami("t_a", "t_a") is False


def test_ami_inexistant():
    assert neo.ajouter_ami("t_a", "n_existe_pas") is False


def test_get_amis_d_amis():
    assert {x["id"] for x in neo.get_amis_d_amis("t_a")} == {"t_c", "t_d"}


def test_amis_d_amis_exclut_les_amis_directs():
    neo.ajouter_ami("t_a", "t_c")
    assert "t_c" not in {x["id"] for x in neo.get_amis_d_amis("t_a")}


def test_supprimer_ami():
    assert neo.supprimer_ami("t_a", "t_b") is True
    assert neo.get_amis("t_a") == []
    assert neo.supprimer_ami("t_a", "t_b") is False


def test_supprimer_noeud_supprime_les_amities():
    neo.supprimer_noeud("t_b")
    assert neo.get_amis("t_a") == []