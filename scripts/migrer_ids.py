"""
Migration des identifiants de joueurs vers le format « pseudo-suffixe ».

Ancien format : « j1 », « j2 », … (saisi à la main, peu significatif)
Nouveau format : « salma-a3f9c1 » (slug du pseudo + suffixe hexadécimal)

Réécrit l'identifiant dans les 3 bases :
  - MongoDB : _id des profils + joueur_id de l'historique
  - Redis   : membre du sorted set `classement_global`
  - Neo4j   : propriété `id` des noeuds (les amitiés suivent le noeud, rien n'est perdu)

Utilisation :
    python -m scripts.migrer_ids
"""

import re

from app.joueur_service import FORMAT_ID, generer_id
from app.services import mongo_service as mongo
from app.services import neo4j_service as neo4j
from app.services.redis_service import RedisService


def _construire_correspondance(profils):
    """Associe chaque ancien id à un nouvel id unique au nouveau format."""
    utilises = {p["_id"] for p in profils if re.match(FORMAT_ID, p["_id"])}
    correspondance = {}
    for profil in profils:
        ancien = profil["_id"]
        if re.match(FORMAT_ID, ancien):
            continue                       # déjà au nouveau format
        nouveau = generer_id(profil.get("pseudo", "joueur"))
        while nouveau in utilises:
            nouveau = generer_id(profil.get("pseudo", "joueur"))
        utilises.add(nouveau)
        correspondance[ancien] = nouveau
    return correspondance


def run():
    """Migre tous les identifiants encore à l'ancien format."""
    redis = RedisService()
    profils = mongo.lister_joueurs()
    correspondance = _construire_correspondance(profils)

    if not correspondance:
        print("Aucun identifiant à migrer : tous les joueurs sont déjà au nouveau format.")
        return

    print(f"{len(correspondance)} identifiant(s) à migrer :\n")
    for ancien, nouveau in correspondance.items():
        print(f"  {ancien:<12} -> {nouveau}")
    print()

    for ancien, nouveau in correspondance.items():
        # --- MongoDB : _id ne peut pas être modifié en place -> recopie du document ---
        profil = mongo.get_profil(ancien)
        profil["_id"] = nouveau
        mongo.joueurs.insert_one(profil)
        mongo.joueurs.delete_one({"_id": ancien})
        mongo.historique_col.update_many({"joueur_id": ancien}, {"$set": {"joueur_id": nouveau}})

        # --- Redis : nouveau membre avec le même score, ancien supprimé ---
        score = redis.get_score(ancien)
        if score is not None:
            redis.set_score(nouveau, score)
            redis.delete_score(ancien)

        # --- Neo4j : on renomme le noeud (les amitiés restent attachées) ---
        neo4j.renommer_id(ancien, nouveau)

    print(f"Migration terminée : {len(correspondance)} identifiant(s) réécrit(s).")


if __name__ == "__main__":
    run()
