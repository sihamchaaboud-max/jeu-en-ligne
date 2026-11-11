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
def sont_amis(id_a: str, id_b: str) -> bool:
    res = _run("MATCH (:Joueur {id:$a})-[r:AMI_DE]-(:Joueur {id:$b}) "
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
    """Liste des amis : [{'id': ..., 'pseudo': ...}, ...]"""
    res = _run("MATCH (:Joueur {id:$id})-[:AMI_DE]-(f:Joueur) "
               "RETURN f.id AS id, f.pseudo AS pseudo ORDER BY pseudo",
               id=joueur_id)
    return [{"id": r["id"], "pseudo": r["pseudo"]} for r in res]


def get_amis_d_amis(joueur_id: str, limite: int = 20) -> list[dict]:
    """Amis d'amis qui ne sont PAS déjà amis, triés par nombre d'amis en commun.
    [{'id':..., 'pseudo':..., 'amis_communs': n}, ...]"""
    res = _run(
        "MATCH (p:Joueur {id:$id})-[:AMI_DE]-(:Joueur)-[:AMI_DE]-(fof:Joueur) "
        "WHERE fof <> p AND NOT (p)-[:AMI_DE]-(fof) "
        "RETURN fof.id AS id, fof.pseudo AS pseudo, count(*) AS amis_communs "
        "ORDER BY amis_communs DESC, pseudo LIMIT $limite",
        id=joueur_id, limite=limite)
    return [dict(r) for r in res]


def get_ids_amis(joueur_id: str) -> list[str]:
    """Pour Oussama : les ids des amis, à croiser avec Redis (classement entre amis)."""
    return [a["id"] for a in get_amis(joueur_id)]