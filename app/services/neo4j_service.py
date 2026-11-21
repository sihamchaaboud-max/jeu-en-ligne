"""Neo4j : relations d'amitié entre joueurs (Salma).

Modèle :  (:Joueur {id, pseudo}) -[:AMI_DE]- (:Joueur)
- `id` est le MÊME identifiant que dans MongoDB (_id) et Redis (membre du sorted set).
- L'amitié est stockée dans un seul sens mais toujours lue SANS direction :
  (A)-[:AMI_DE]-(B) signifie « A et B sont amis ».
"""
from neo4j import GraphDatabase

from app.config import NEO4J_PASSWORD, NEO4J_URL, NEO4J_USER

_driver = GraphDatabase.driver(NEO4J_URL, auth=(NEO4J_USER, NEO4J_PASSWORD))


def _run(query, **params):
    with _driver.session() as session:
        return list(session.run(query, **params))


def fermer():
    _driver.close()


def verifier_connexion():
    """Lève une erreur si Neo4j est injoignable ou si le mot de passe est faux."""
    _driver.verify_connectivity()


def initialiser_schema():
    """Contrainte d'unicité sur Joueur.id (crée aussi un index => recherches rapides)."""
    _run("CREATE CONSTRAINT joueur_id IF NOT EXISTS "
         "FOR (j:Joueur) REQUIRE j.id IS UNIQUE")


# ---------------- noeuds ----------------
def creer_noeud(joueur_id: str, pseudo: str) -> None:
    """Crée le noeud du joueur (ou met à jour son pseudo s'il existe déjà)."""
    _run("MERGE (j:Joueur {id: $id}) SET j.pseudo = $pseudo",
         id=joueur_id, pseudo=pseudo)


def supprimer_noeud(joueur_id: str) -> None:
    """Supprime le joueur ET toutes ses amitiés."""
    _run("MATCH (j:Joueur {id: $id}) DETACH DELETE j", id=joueur_id)


# ---------------- amitiés ----------------
# Une relation AMI_DE porte un statut :
#   "acceptee"   — amitié confirmée (les vieilles relations sans statut comptent comme acceptées)
#   "en_attente" — demande d'ami en attente d'acceptation (sens : demandeur -> cible)
_SQL_AMIS = "coalesce(r.statut, 'acceptee') = 'acceptee'"


def sont_amis(id_a: str, id_b: str) -> bool:
    """True si A et B ont une amitié ACCEPTEE (une demande en attente ne compte pas)."""
    res = _run("MATCH (:Joueur {id:$a})-[r:AMI_DE]-(:Joueur {id:$b}) "
               f"WHERE {_SQL_AMIS} "
               "RETURN count(r) AS n", a=id_a, b=id_b)
    return res[0]["n"] > 0


def ajouter_ami(id_a: str, id_b: str) -> bool:
    """Crée l'amitié A-B. Pas de doublon, même si on l'appelle deux fois
    ou dans l'autre sens. Renvoie True si A et B sont amis après l'appel,
    False si l'un des joueurs n'existe pas ou si A == B."""
    if id_a == id_b:
        return False
    _run("MATCH (a:Joueur {id:$a}), (b:Joueur {id:$b}) "
         "WHERE NOT (a)-[:AMI_DE]-(b) "
         "CREATE (a)-[:AMI_DE]->(b)", a=id_a, b=id_b)
    return sont_amis(id_a, id_b)


def supprimer_ami(id_a: str, id_b: str) -> bool:
    """Supprime l'amitié A-B quel que soit son sens. True si elle existait."""
    res = _run("MATCH (:Joueur {id:$a})-[r:AMI_DE]-(:Joueur {id:$b}) "
               "DELETE r RETURN count(r) AS n", a=id_a, b=id_b)
    return res[0]["n"] > 0


# ---------------- lectures ----------------
def get_amis(joueur_id: str) -> list[dict]:
    """Liste des amis acceptés : [{'id': ..., 'pseudo': ...}, ...]"""
    res = _run(
        f"MATCH (:Joueur {{id:$id}})-[r:AMI_DE]-(f:Joueur) "
        f"WHERE {_SQL_AMIS} "
        "RETURN f.id AS id, f.pseudo AS pseudo ORDER BY pseudo",
        id=joueur_id)
    return [{"id": r["id"], "pseudo": r["pseudo"]} for r in res]


def get_amis_d_amis(joueur_id: str, limite: int = 20) -> list[dict]:
    """Amis d'amis qui ne sont PAS déjà amis, triés par nombre d'amis en commun.
    [{'id':..., 'pseudo':..., 'amis_communs': n}, ...]"""
    res = _run(
        f"MATCH (p:Joueur {{id:$id}})-[r1:AMI_DE]-(:Joueur)-[r2:AMI_DE]-(fof:Joueur) "
        f"WHERE {_SQL_AMIS.replace('r.', 'r1.')} AND {_SQL_AMIS.replace('r.', 'r2.')} "
        "AND fof <> p AND NOT (p)-[:AMI_DE]-(fof) "
        "RETURN fof.id AS id, fof.pseudo AS pseudo, count(*) AS amis_communs "
        "ORDER BY amis_communs DESC, pseudo LIMIT $limite",
        id=joueur_id, limite=limite)
    return [dict(r) for r in res]


# ---------------- demandes d'ami (pending -> acceptation) ----------------
def demander_ami(id_de: str, id_vers: str) -> bool:
    """Crée une DEMANDE d'ami (relation en attente, sens demandeur -> cible).
    False si ids identiques, joueur inexistant, déjà amis ou demande déjà en cours."""
    if id_de == id_vers:
        return False
    deja = _run(
        "MATCH (:Joueur {id:$de})-[r:AMI_DE]-(:Joueur {id:$vers}) "
        "RETURN count(r) AS n", de=id_de, vers=id_vers)
    if deja[0]["n"] > 0:          # déjà amis ou demande déjà en attente
        return False
    _run(
        "MATCH (a:Joueur {id:$de}), (b:Joueur {id:$vers}) "
        "CREATE (a)-[:AMI_DE {statut: 'en_attente'}]->(b)",
        de=id_de, vers=id_vers)
    verif = _run(
        "MATCH (:Joueur {id:$de})-[r:AMI_DE]->(:Joueur {id:$vers}) "
        "WHERE r.statut = 'en_attente' "
        "RETURN count(r) AS n", de=id_de, vers=id_vers)
    return verif[0]["n"] > 0


def accepter_demande(id_de: str, id_vers: str) -> bool:
    """id_vers ACCEPTE la demande envoyée par id_de. True si une demande en attente existait."""
    res = _run(
        "MATCH (:Joueur {id:$de})-[r:AMI_DE]->(:Joueur {id:$vers}) "
        "WHERE r.statut = 'en_attente' "
        "SET r.statut = 'acceptee' "
        "RETURN r.statut AS statut",
        de=id_de, vers=id_vers)
    return bool(res)


def refuser_demande(id_de: str, id_vers: str) -> bool:
    """id_vers REFUSE la demande de id_de (la relation en attente est supprimée)."""
    res = _run(
        "MATCH (:Joueur {id:$de})-[r:AMI_DE]->(:Joueur {id:$vers}) "
        "WHERE r.statut = 'en_attente' "
        "DELETE r "
        "RETURN count(r) AS n",
        de=id_de, vers=id_vers)
    return res[0]["n"] > 0


def get_demandes(joueur_id: str) -> dict:
    """Demandes d'ami d'un joueur.
    Returns:
        {"recues":   [{"id","pseudo"}...],   demandes que j'ai reçues (à accepter/refuser)
         "envoyees": [{"id","pseudo"}...]}   demandes que j'ai envoyées (en attente)
    """
    recues = _run(
        "MATCH (moi:Joueur {id:$id})<-[r:AMI_DE]-(d:Joueur) "
        "WHERE r.statut = 'en_attente' "
        "RETURN d.id AS id, d.pseudo AS pseudo ORDER BY pseudo",
        id=joueur_id)
    envoyees = _run(
        "MATCH (moi:Joueur {id:$id})-[r:AMI_DE]->(c:Joueur) "
        "WHERE r.statut = 'en_attente' "
        "RETURN c.id AS id, c.pseudo AS pseudo ORDER BY pseudo",
        id=joueur_id)
    return {
        "recues":   [{"id": r["id"], "pseudo": r["pseudo"]} for r in recues],
        "envoyees": [{"id": r["id"], "pseudo": r["pseudo"]} for r in envoyees],
    }


def aretes_acceptees() -> list[dict]:
    """Toutes les amitiés confirmées : [{'a': id, 'b': id}, ...] (pour la visualisation du graphe)."""
    res = _run(
        f"MATCH (a:Joueur)-[r:AMI_DE]->(b:Joueur) "
        f"WHERE {_SQL_AMIS} "
        "RETURN a.id AS a, b.id AS b")
    return [{"a": r["a"], "b": r["b"]} for r in res]


def get_ids_amis(joueur_id: str) -> list[str]:
    """Pour Oussama : les ids des amis, à croiser avec Redis (classement entre amis)."""
    return [a["id"] for a in get_amis(joueur_id)]
