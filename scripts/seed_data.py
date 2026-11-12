"""
Seed data - Jeu de données de test

Crée 10 joueurs fictifs avec :
  - Un profil MongoDB (pseudo, niveau, inventaire)
  - Un score Redis
  - Un noeud Neo4j + relations d'amitié

Utilisation :
    python -m scripts.seed_data

Les amitiés forment un réseau qui permet de tester
le classement entre amis et les recommandations (amis d'amis).
"""

from app.joueur_service import JoueurService
from app.services import neo4j_service as neo4j
from app.services import mongo_service as mongo

# --------------------------------------------------
# 10 joueurs de test
# --------------------------------------------------
JOUEURS = [
    {"id": "j1",  "nom": "Oussama", "niveau": 10, "score": 8500},
    {"id": "j2",  "nom": "Siham",   "niveau": 8,  "score": 7200},
    {"id": "j3",  "nom": "Yassine", "niveau": 7,  "score": 6800},
    {"id": "j4",  "nom": "Salma",   "niveau": 9,  "score": 9100},
    {"id": "j5",  "nom": "Mehdi",   "niveau": 5,  "score": 4200},
    {"id": "j6",  "nom": "Anas",    "niveau": 6,  "score": 5500},
    {"id": "j7",  "nom": "Imane",   "niveau": 4,  "score": 3100},
    {"id": "j8",  "nom": "Karim",   "niveau": 3,  "score": 2400},
    {"id": "j9",  "nom": "Nada",    "niveau": 7,  "score": 6600},
    {"id": "j10", "nom": "Hamza",   "niveau": 5,  "score": 4800},
]

# --------------------------------------------------
# Amitiés (réseau avec amis d'amis exploitables)
# --------------------------------------------------
AMITIES = [
    ("j1", "j2"), ("j1", "j3"), ("j1", "j5"),
    ("j2", "j4"), ("j2", "j6"),
    ("j3", "j7"), ("j3", "j9"),
    ("j4", "j8"),
    ("j5", "j10"),
    ("j6", "j7"),
    ("j8", "j9"),
    ("j9", "j10"),
]

# --------------------------------------------------
# Inventaires de test
# --------------------------------------------------
INVENTAIRES = {
    "j1":  [("épée", 1), ("potion", 3)],
    "j2":  [("arc", 1), ("flèche", 20)],
    "j3":  [("bouclier", 1)],
    "j4":  [("épée", 1), ("armure", 1), ("potion", 5)],
    "j5":  [("baguette", 1), ("potion", 2)],
    "j6":  [("hache", 1)],
    "j7":  [("arc", 1), ("potion", 4)],
    "j8":  [],
    "j9":  [("épée", 1), ("bouclier", 1)],
    "j10": [("potion", 10)],
}


def run():
    """Insère toutes les données de test dans les 3 bases."""
    service = JoueurService()

    print("Création des 10 joueurs (Mongo + Redis + Neo4j)...")
    for j in JOUEURS:
        # Nettoyer si déjà présent
        if mongo.joueur_existe(j["id"]):
            mongo.supprimer_profil(j["id"])
            service.redis.delete_score(j["id"])
            neo4j.supprimer_noeud(j["id"])

        service.creer_joueur(j["id"], j["nom"], j["niveau"], j["score"])

        # Ajouter les objets à l'inventaire
        for objet, qte in INVENTAIRES.get(j["id"], []):
            mongo.ajouter_objet(j["id"], objet, qte)

        print(f"  ✓ {j['nom']:<10} (ID: {j['id']}, score: {j['score']})")

    print("\nAjout des amitiés (Neo4j)...")
    for j1, j2 in AMITIES:
        neo4j.ajouter_ami(j1, j2)
        print(f"  ✓ {j1} <-> {j2}")

    print("\n" + "=" * 50)
    print("  Données de test insérées avec succès !")
    print("=" * 50)

    # --- Vérifications ---
    print("\n--- Top 10 global ---")
    for entry in service.get_top_10_global():
        print(f"  #{entry['rang']}  {entry['nom']:<10}  {entry['score']} pts")

    print("\n--- Classement entre amis de j1 (Oussama) ---")
    for entry in service.get_classement_amis("j1"):
        print(f"  #{entry['rang']}  {entry['nom']:<10}  {entry['score']} pts")

    print("\n--- Amis d'amis de j1 (recommandations) ---")
    for rec in neo4j.get_amis_d_amis("j1"):
        print(f"  {rec['id']:<6} {rec['pseudo']:<10}  ({rec['amis_communs']} amis en commun)")

    service.close()


if __name__ == "__main__":
    run()
