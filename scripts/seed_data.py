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
# Identifiants au format « pseudo-suffixe » (ex. salma-a3f9c1)
# --------------------------------------------------
OUSSAMA, SIHAM, YASSINE, SALMA, MEHDI = (
    "oussama-1f3a9c", "siham-7d2e10", "yassine-4b8c22", "salma-a3f9c1", "mehdi-2c6df4",
)
ANAS, IMANE, KARIM, NADA, HAMZA = (
    "anas-9e1b57", "imane-6a4d83", "karim-8f0c25", "nada-3d7b91", "hamza-5e2a48",
)

# --------------------------------------------------
# 10 joueurs de test
# --------------------------------------------------
JOUEURS = [
    {"id": OUSSAMA, "nom": "Oussama", "niveau": 10, "score": 8500},
    {"id": SIHAM,   "nom": "Siham",   "niveau": 8,  "score": 7200},
    {"id": YASSINE, "nom": "Yassine", "niveau": 7,  "score": 6800},
    {"id": SALMA,   "nom": "Salma",   "niveau": 9,  "score": 9100},
    {"id": MEHDI,   "nom": "Mehdi",   "niveau": 5,  "score": 4200},
    {"id": ANAS,    "nom": "Anas",    "niveau": 6,  "score": 5500},
    {"id": IMANE,   "nom": "Imane",   "niveau": 4,  "score": 3100},
    {"id": KARIM,   "nom": "Karim",   "niveau": 3,  "score": 2400},
    {"id": NADA,    "nom": "Nada",    "niveau": 7,  "score": 6600},
    {"id": HAMZA,   "nom": "Hamza",   "niveau": 5,  "score": 4800},
]

# --------------------------------------------------
# Amitiés (réseau avec amis d'amis exploitables)
# --------------------------------------------------
AMITIES = [
    (OUSSAMA, SIHAM), (OUSSAMA, YASSINE), (OUSSAMA, MEHDI),
    (SIHAM, SALMA), (SIHAM, ANAS),
    (YASSINE, IMANE), (YASSINE, NADA),
    (SALMA, KARIM),
    (MEHDI, HAMZA),
    (ANAS, IMANE),
    (KARIM, NADA),
    (NADA, HAMZA),
]

# --------------------------------------------------
# Inventaires de test
# --------------------------------------------------
INVENTAIRES = {
    OUSSAMA: [("épée", 1), ("potion", 3)],
    SIHAM:   [("arc", 1), ("flèche", 20)],
    YASSINE: [("bouclier", 1)],
    SALMA:   [("épée", 1), ("armure", 1), ("potion", 5)],
    MEHDI:   [("baguette", 1), ("potion", 2)],
    ANAS:    [("hache", 1)],
    IMANE:   [("arc", 1), ("potion", 4)],
    KARIM:   [],
    NADA:    [("épée", 1), ("bouclier", 1)],
    HAMZA:   [("potion", 10)],
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

    print("\n--- Classement entre amis de Oussama ---")
    for entry in service.get_classement_amis(OUSSAMA):
        print(f"  #{entry['rang']}  {entry['nom']:<10}  {entry['score']} pts")

    print("\n--- Amis d'amis de Oussama (recommandations) ---")
    for rec in neo4j.get_amis_d_amis(OUSSAMA):
        print(f"  {rec['id']:<20} {rec['pseudo']:<10}  ({rec['amis_communs']} amis en commun)")

    service.close()


if __name__ == "__main__":
    run()
