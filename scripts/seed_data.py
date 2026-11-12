"""
Seed data - Jeu de données de test

Crée 10 joueurs fictifs avec :
  - Un profil MongoDB (nom, niveau)
  - Un score Redis
  - Un noeud Neo4j
  - Des relations d'amitié entre eux

Utilisation :
    python -m scripts.seed_data

Les amitiés créées forment un réseau qui permet de tester
le classement entre amis et les recommandations (amis d'amis).
"""

from app.joueur_service import JoueurService
from app.services import neo4j_service as neo4j


# --------------------------------------------------
# Définition des 10 joueurs de test
# --------------------------------------------------
JOUEURS = [
    {"id": "j1", "nom": "Oussama", "niveau": 10, "score": 8500},
    {"id": "j2", "nom": "Siham", "niveau": 8, "score": 7200},
    {"id": "j3", "nom": "Yassine", "niveau": 7, "score": 6800},
    {"id": "j4", "nom": "Salma", "niveau": 9, "score": 9100},
    {"id": "j5", "nom": "Mehdi", "niveau": 5, "score": 4200},
    {"id": "j6", "nom": "Anas", "niveau": 6, "score": 5500},
    {"id": "j7", "nom": "Imane", "niveau": 4, "score": 3100},
    {"id": "j8", "nom": "Karim", "niveau": 3, "score": 2400},
    {"id": "j9", "nom": "Nada", "niveau": 7, "score": 6600},
    {"id": "j10", "nom": "Hamza", "niveau": 5, "score": 4800},
]

# --------------------------------------------------
# Relations d'amitié (bidirectionnelles)
# j1 est ami avec j2, j3, j5  ->  j2 est ami avec j1, j4  etc.
# Cela crée un réseau avec des amis d'amis exploitables.
# --------------------------------------------------
AMITIES = [
    ("j1", "j2"),
    ("j1", "j3"),
    ("j1", "j5"),
    ("j2", "j4"),
    ("j2", "j6"),
    ("j3", "j7"),
    ("j3", "j9"),
    ("j4", "j8"),
    ("j5", "j10"),
    ("j6", "j7"),
    ("j8", "j9"),
    ("j9", "j10"),
]


def run():
    """Insère toutes les données de test dans les 3 bases."""
    service = JoueurService()

    print("Création des 10 joueurs...")
    for j in JOUEURS:
        service.creer_joueur(j["id"], j["nom"], j["niveau"], j["score"])
        print(f"  ✓ {j['nom']} (ID: {j['id']}, score: {j['score']})")

    print("\nAjout des amitiés...")
    for j1, j2 in AMITIES:
        neo4j.ajouter_ami(j1, j2)
        print(f"  ✓ {j1} <-> {j2}")

    print("\n" + "=" * 50)
    print("  Données de test insérées avec succès !")
    print("=" * 50)

    # Vérification rapide : Top 10 global
    print("\n--- Top 10 global ---")
    top = service.get_top_10_global()
    for entry in top:
        print(f"  #{entry['rang']}  {entry['nom']:<10}  {entry['score']} pts")

    # Vérification : classement entre amis de j1
    print("\n--- Classement entre amis de j1 (Oussama) ---")
    classement = service.get_classement_amis("j1")
    for entry in classement:
        print(f"  #{entry['rang']}  {entry['nom']:<10}  {entry['score']} pts")

    # Vérification : amis d'amis de j1
    print("\n--- Amis d'amis de j1 (recommandations) ---")
    recommandations = neo4j.get_amis_d_amis("j1")
    for rec in recommandations:
        print(f"  {rec['id']:<6} {rec['pseudo']}  ({rec['amis_communs']} amis en commun)")

    service.close()


if __name__ == "__main__":
    run()
