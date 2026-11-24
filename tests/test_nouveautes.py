"""Tests des endpoints ajoutés pour le nouveau frontend :
   graphe social, classement paginé, classement autour, demandes d'ami,
   mode entraînement du quiz."""

from fastapi.testclient import TestClient

from app import auth_service as auth
from app.api import app, service
from app.services import mongo_service as mongo
from app.services import neo4j_service as neo4j

client = TestClient(app)

IDS = ["feat_g1", "feat_g2", "feat_g3", "feat_g4"]


def _token(joueur_id):
    """En-tête Authorization d'un joueur (jeton forgé, comme le ferait un login)."""
    return {"Authorization": f"Bearer {auth.creer_token(joueur_id)}"}


def _proteger(joueur_id, mot_de_passe="secret123"):
    """Donne un mot de passe à un joueur : il exige alors son propre jeton."""
    mongo.definir_mot_de_passe(joueur_id, auth.hacher_mot_de_passe(mot_de_passe))


def calculer(texte):
    a, op, b = texte.split()
    a, b = int(a), int(b)
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    return a * b


def _nettoyer():
    for pid in IDS:
        if mongo.joueur_existe(pid):
            service.supprimer_joueur(pid)
    mongo.historique_col.delete_many({"joueur_id": {"$in": IDS}})


def setup_function(_):
    _nettoyer()
    service.creer_joueur("feat_g1", "GrapheUn",  1, 300)
    service.creer_joueur("feat_g2", "GrapheDeux", 1, 200)
    service.creer_joueur("feat_g3", "GrapheTrois", 1, 100)
    service.creer_joueur("feat_g4", "GrapheQuatre", 1, 50)
    neo4j.ajouter_ami("feat_g1", "feat_g2")
    neo4j.ajouter_ami("feat_g2", "feat_g3")


def teardown_function(_):
    _nettoyer()


# ─────────────────────────────────────────────
# Graphe social complet
# ─────────────────────────────────────────────
def test_graphe_contient_noeuds_et_aretes():
    r = client.get("/api/graphe")
    assert r.status_code == 200
    d = r.json()
    ids = {n["id"] for n in d["noeuds"]}
    assert {"feat_g1", "feat_g2"} <= ids
    assert all("mot_de_passe" not in n for n in d["noeuds"])
    g1g2 = [e for e in d["aretes"] if {e["a"], e["b"]} == {"feat_g1", "feat_g2"}]
    assert g1g2, "l'amitié g1-g2 doit apparaître comme arête"


# ─────────────────────────────────────────────
# Classement paginé + autour
# ─────────────────────────────────────────────
def test_classement_page():
    r = client.get("/api/classement?page=1&par_page=2")
    d = r.json()
    assert d["total"] >= 4
    assert len(d["entrees"]) == 2
    # scores décroissants et rangs continus
    scores = [e["score"] for e in d["entrees"]]
    assert scores == sorted(scores, reverse=True)
    assert d["entrees"][0]["rang"] == 1


def test_classement_autour():
    rayon = 2
    r = client.get(f"/api/classement-autour/feat_g3?rayon={rayon}")
    assert r.status_code == 200
    d = r.json()

    # Plusieurs joueurs réels peuvent dépasser les scores de test : on compare
    # au rang courant du classement Redis au lieu d'un rang codé en dur.
    rang_attendu, fenetre = service.redis.get_autour("feat_g3", rayon)
    assert d["rang"] == rang_attendu
    assert [e["id"] for e in d["entrees"]] == [pid for _, pid, _ in fenetre]
    assert "feat_g3" in [e["id"] for e in d["entrees"]]   # le joueur central est inclus

    rangs = [e["rang"] for e in d["entrees"]]
    assert rangs == list(range(min(rangs), max(rangs) + 1))    # fenêtre continue
    assert all(abs(rg - d["rang"]) <= rayon for rg in rangs)   # bornée par le rayon


def test_classement_autour_inconnu_404():
    r = client.get("/api/classement-autour/personne_abc")
    assert r.status_code == 404


# ─────────────────────────────────────────────
# Demandes d'ami
# ─────────────────────────────────────────────
def test_cycle_demande_ami():
    # envoi
    r = client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 201

    # la demande n'est PAS une amitié tant qu'elle n'est pas acceptée
    assert neo4j.sont_amis("feat_g3", "feat_g1") is False
    assert {"id": "feat_g3"} == {"id": client.get("/api/demandes-ami/feat_g1").json()["recues"][0]["id"]}

    # doublon refusé
    r = client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 409

    # refus → plus rien en attente
    r = client.post("/api/demande-ami/refuser", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 200
    assert client.get("/api/demandes-ami/feat_g1").json()["recues"] == []

    # nouvelle demande → acceptation → amitié réelle
    r = client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 201
    r = client.post("/api/demande-ami/accepter", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 200
    assert neo4j.sont_amis("feat_g3", "feat_g1") is True
    recues = client.get("/api/demandes-ami/feat_g1").json()["recues"]
    assert recues == []


def test_demande_ami_sur_soi_meme():
    r = client.post("/api/demande-ami", json={"id_de": "feat_g1", "id_vers": "feat_g1"})
    assert r.status_code == 409


def test_accepter_sans_demande_404():
    r = client.post("/api/demande-ami/accepter", json={"id_de": "feat_g4", "id_vers": "feat_g1"})
    assert r.status_code == 404


# ─────────────────────────────────────────────
# Quiz — mode entraînement
# ─────────────────────────────────────────────
def test_quiz_mode_entrainement_ne_compte_pas():
    score_avant = service.redis.get_score("feat_g4")
    r = client.post("/api/quiz/start", json={"joueur_id": "feat_g4", "mode": "entrainement"})
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "entrainement"

    partie_id, question = data["partie_id"], data["question"]
    while True:
        r = client.post("/api/quiz/answer",
                        json={"partie_id": partie_id, "reponse": str(calculer(question))})
        res = r.json()
        assert res["correct"] is True
        if res["termine"]:
            break
        question = res["question"]

    assert res.get("entrainement") is True
    assert "nouveau_score" not in res            # rien n'est compté
    assert service.redis.get_score("feat_g4") == score_avant
    assert mongo.get_historique("feat_g4") == []  # pas d'historique non plus


def test_quiz_mode_invalide_422():
    r = client.post("/api/quiz/start", json={"joueur_id": "feat_g4", "mode": "hardcore"})
    assert r.status_code == 422


# ─────────────────────────────────────────────
# Espace social — profil + réseau en une requête
# ─────────────────────────────────────────────
def test_espace_social_agrege_profil_reseau_et_invitations():
    client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})

    r = client.get("/api/social/feat_g1")
    assert r.status_code == 200
    d = r.json()

    # MongoDB → identité et inventaire ; Redis → score et rang
    assert d["profil"]["id"] == "feat_g1"
    assert d["profil"]["pseudo"] == "GrapheUn"
    assert d["profil"]["score"] == service.redis.get_score("feat_g1")
    assert "mot_de_passe" not in d["profil"]
    assert "inventaire" in d["profil"]
    assert "nb_parties" in d["stats"]

    # Neo4j → amitiés acceptées + invitations en attente
    assert [a["id"] for a in d["amis"]] == ["feat_g2"]
    assert d["profil"]["nb_amis"] == 1
    assert [x["id"] for x in d["demandes"]["recues"]] == ["feat_g3"]
    assert d["demandes"]["envoyees"] == []


def test_suggestions_excluent_les_invitations_en_attente():
    # feat_g3 est ami d'amie de feat_g1 (via feat_g2) → c'est une suggestion
    avant = client.get("/api/social/feat_g1").json()["suggestions"]
    assert "feat_g3" in [s["id"] for s in avant]

    # ...mais dès qu'une invitation est en attente, elle disparaît des suggestions
    r = client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 201
    apres = client.get("/api/social/feat_g1").json()["suggestions"]
    assert "feat_g3" not in [s["id"] for s in apres]


# ─────────────────────────────────────────────
# Espace social — sécurité (comptes protégés par mot de passe)
# ─────────────────────────────────────────────
def test_espace_social_prive():
    _proteger("feat_g1")

    assert client.get("/api/social/feat_g1").status_code == 401            # sans jeton
    assert client.get("/api/social/feat_g1", headers=_token("feat_g4")).status_code == 403
    assert client.get("/api/social/feat_g1", headers=_token("feat_g1")).status_code == 200


def test_boite_de_reception_privee():
    _proteger("feat_g1")

    assert client.get("/api/demandes-ami/feat_g1").status_code == 401
    assert client.get("/api/demandes-ami/feat_g1", headers=_token("feat_g4")).status_code == 403
    assert client.get("/api/demandes-ami/feat_g1", headers=_token("feat_g1")).status_code == 200


def test_invitation_refusee_sans_le_jeton_du_demandeur():
    _proteger("feat_g2")

    # un compte protégé ne peut pas envoyer une demande sans son jeton…
    r = client.post("/api/demande-ami", json={"id_de": "feat_g2", "id_vers": "feat_g4"})
    assert r.status_code == 401

    # …ni avec le jeton d'un autre joueur (usurpation)
    r = client.post("/api/demande-ami", json={"id_de": "feat_g2", "id_vers": "feat_g4"},
                    headers=_token("feat_g4"))
    assert r.status_code == 403

    # avec son propre jeton, la demande aboutit
    r = client.post("/api/demande-ami", json={"id_de": "feat_g2", "id_vers": "feat_g4"},
                    headers=_token("feat_g2"))
    assert r.status_code == 201


def test_acceptation_reservee_au_destinataire():
    client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    _proteger("feat_g1")

    # un tiers, même avec un jeton valide, ne peut pas accepter à la place du destinataire
    r = client.post("/api/demande-ami/accepter",
                    json={"id_de": "feat_g3", "id_vers": "feat_g1"},
                    headers=_token("feat_g4"))
    assert r.status_code == 403
    assert neo4j.sont_amis("feat_g3", "feat_g1") is False

    # le destinataire peut accepter → l'amitié est bidirectionnelle
    r = client.post("/api/demande-ami/accepter",
                    json={"id_de": "feat_g3", "id_vers": "feat_g1"},
                    headers=_token("feat_g1"))
    assert r.status_code == 200
    assert neo4j.sont_amis("feat_g1", "feat_g3") is True
    assert neo4j.sont_amis("feat_g3", "feat_g1") is True
    assert neo4j.get_demandes("feat_g1")["recues"] == []


def test_refus_par_un_tiers_interdit():
    client.post("/api/demande-ami", json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    _proteger("feat_g3")
    _proteger("feat_g1")

    r = client.post("/api/demande-ami/refuser",
                    json={"id_de": "feat_g3", "id_vers": "feat_g1"},
                    headers=_token("feat_g4"))
    assert r.status_code == 403

    # deux comptes protégés : sans jeton, plus aucun accès
    r = client.post("/api/demande-ami/refuser",
                    json={"id_de": "feat_g3", "id_vers": "feat_g1"})
    assert r.status_code == 401

    # le destinataire refuse → plus rien en attente, aucune amitié créée
    r = client.post("/api/demande-ami/refuser",
                    json={"id_de": "feat_g3", "id_vers": "feat_g1"},
                    headers=_token("feat_g1"))
    assert r.status_code == 200
    assert neo4j.sont_amis("feat_g3", "feat_g1") is False
    assert neo4j.get_demandes("feat_g1")["recues"] == []


def test_amitie_directe_reservee_a_sa_propre_identite():
    _proteger("feat_g4")

    # on ne peut pas modifier le réseau d'un autre joueur
    r = client.post("/api/ami", json={"id_a": "feat_g1", "id_b": "feat_g4"},
                    headers=_token("feat_g4"))
    assert r.status_code == 403

    # en son propre nom, c'est autorisé
    r = client.post("/api/ami", json={"id_a": "feat_g4", "id_b": "feat_g1"},
                    headers=_token("feat_g4"))
    assert r.status_code == 201
    assert neo4j.sont_amis("feat_g1", "feat_g4") is True
