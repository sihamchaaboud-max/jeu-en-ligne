"""
Menu console - Point d'entrée principal

Permet de tester toutes les fonctionnalités du jeu :
  - Créer un joueur
  - Ajouter des amis
  - Consulter le Top 10 global
  - Consulter le classement entre amis
  - Voir les amis et amis d'amis
  - Mettre à jour un score
  - Supprimer un joueur

Lancer avec :  python -m app.main
"""

from app.joueur_service import JoueurService


def afficher_separateur(titre: str):
    print(f"\n{'=' * 50}")
    print(f"  {titre}")
    print(f"{'=' * 50}")


def afficher_menu():
    print("\n===  JEU EN LIGNE  ===")
    print("1.  Créer un joueur")
    print("2.  Ajouter un ami")
    print("3.  Voir le profil d'un joueur")
    print("4.  Mettre à jour / ajouter un score")
    print("5.  Voir le Top 10 global")
    print("6.  Voir le classement entre amis")
    print("7.  Voir les amis d'un joueur")
    print("8.  Voir les amis d'amis (recommandations)")
    print("9.  Voir l'inventaire d'un joueur")
    print("10. Ajouter un item à un inventaire")
    print("11. Supprimer un joueur")
    print("12. Nombre total de joueurs classés")
    print("0.  Quitter")


def action_creer_joueur(service: JoueurService):
    """Crée un joueur dans les 3 bases."""
    joueur_id = input("ID du joueur : ").strip()
    nom = input("Nom du joueur : ").strip()
    niveau = input("Niveau (défaut 1) : ").strip() or "1"
    score = input("Score initial (défaut 0) : ").strip() or "0"

    service.creer_joueur(joueur_id, nom, int(niveau), int(score))
    print(f"\n✓ Joueur '{nom}' créé dans les 3 bases (Mongo, Redis, Neo4j).")


def action_ajouter_ami(service: JoueurService):
    """Ajoute une relation d'amitié."""
    joueur_id = input("ID du joueur : ").strip()
    ami_id = input("ID de l'ami à ajouter : ").strip()

    service.neo4j.ajouter_amitie(joueur_id, ami_id)
    print(f"\n✓ Amitié ajoutée : {joueur_id} <-> {ami_id}")


def action_voir_profil(service: JoueurService):
    """Affiche le profil d'un joueur."""
    joueur_id = input("ID du joueur : ").strip()

    profil = service.mongo.get_profil(joueur_id)
    if not profil:
        print(f"\n✗ Aucun profil trouvé pour '{joueur_id}'.")
        return

    score = service.redis.get_score(joueur_id)
    rang = service.redis.get_rang(joueur_id)

    print(f"\n--- Profil de {profil.get('nom', '?')} ---")
    print(f"  ID      : {profil['_id']}")
    print(f"  Niveau  : {profil.get('niveau', '?')}")
    print(f"  XP      : {profil.get('xp', 0)}")
    print(f"  Score   : {score if score is not None else 'Non classé'}")
    print(f"  Rang    : {rang if rang is not None else 'N/A'}")


def action_update_score(service: JoueurService):
    """Met à jour le score d'un joueur."""
    joueur_id = input("ID du joueur : ").strip()
    points = input("Points à ajouter (peut être négatif) : ").strip()

    nouveau_score = service.redis.increment_score(joueur_id, int(points))
    print(f"\n✓ Score de '{joueur_id}' mis à jour. Nouveau score : {int(nouveau_score)}")


def action_top_10(service: JoueurService):
    """Affiche le Top 10 global."""
    top = service.get_top_10_global()

    if not top:
        print("\nAucun joueur classé pour le moment.")
        return

    print("\n--- TOP 10 GLOBAL ---")
    print(f"{'Rang':<6} {'ID':<15} {'Nom':<15} {'Score':<10}")
    print("-" * 46)
    for entry in top:
        print(f"{entry['rang']:<6} {entry['id']:<15} {entry['nom']:<15} {entry['score']:<10}")


def action_classement_amis(service: JoueurService):
    """Affiche le classement entre amis d'un joueur."""
    joueur_id = input("ID du joueur : ").strip()

    classement = service.get_classement_amis(joueur_id)

    if not classement:
        print(f"\nAucun ami ou score trouvé pour '{joueur_id}'.")
        return

    print(f"\n--- CLASSEMENT ENTRE AMIS ({joueur_id}) ---")
    print(f"{'Rang':<6} {'ID':<15} {'Nom':<15} {'Score':<10}")
    print("-" * 46)
    for entry in classement:
        print(f"{entry['rang']:<6} {entry['id']:<15} {entry['nom']:<15} {entry['score']:<10}")


def action_voir_amis(service: JoueurService):
    """Affiche les amis directs d'un joueur."""
    joueur_id = input("ID du joueur : ").strip()

    amis = service.neo4j.get_amis(joueur_id)

    if not amis:
        print(f"\n'{joueur_id}' n'a pas encore d'amis.")
        return

    print(f"\n--- AMIS DE {joueur_id} ({len(amis)}) ---")
    for ami in amis:
        print(f"  {ami['id']:<15} {ami['nom']}")


def action_amis_damis(service: JoueurService):
    """Affiche les amis d'amis (recommandations)."""
    joueur_id = input("ID du joueur : ").strip()

    recommandations = service.neo4j.get_amis_damis(joueur_id)

    if not recommandations:
        print(f"\nAucune recommandation d'ami pour '{joueur_id}'.")
        return

    print(f"\n--- AMIS D'AMIS - RECOMMANDATIONS ({joueur_id}) ---")
    for rec in recommandations:
        print(f"  {rec['id']:<15} {rec['nom']}")


def action_voir_inventaire(service: JoueurService):
    """Affiche l'inventaire d'un joueur."""
    joueur_id = input("ID du joueur : ").strip()

    inventaire = service.mongo.get_inventaire(joueur_id)

    if not inventaire:
        print(f"\nInventaire de '{joueur_id}' vide ou inexistant.")
        return

    print(f"\n--- INVENTAIRE DE {joueur_id} ---")
    for item, quantite in inventaire.items():
        print(f"  {item:<20} x{quantite}")


def action_ajouter_item(service: JoueurService):
    """Ajoute un item à l'inventaire d'un joueur."""
    joueur_id = input("ID du joueur : ").strip()
    item = input("Nom de l'item : ").strip()
    quantite = input("Quantité (défaut 1) : ").strip() or "1"

    service.mongo.ajouter_item(joueur_id, item, int(quantite))
    print(f"\n✓ {quantite}x '{item}' ajouté à l'inventaire de '{joueur_id}'.")


def action_supprimer_joueur(service: JoueurService):
    """Supprime un joueur des 3 bases."""
    joueur_id = input("ID du joueur à supprimer : ").strip()
    confirmation = input(f"Confirmer la suppression de '{joueur_id}' ? (o/n) : ").strip().lower()

    if confirmation != "o":
        print("Suppression annulée.")
        return

    service.supprimer_joueur(joueur_id)
    print(f"\n✓ Joueur '{joueur_id}' supprimé des 3 bases.")


def action_nombre_joueurs(service: JoueurService):
    """Affiche le nombre total de joueurs classés."""
    total = service.redis.get_nombre_joueurs()
    print(f"\nNombre total de joueurs classés : {total}")


def main():
    """Boucle principale du menu console."""
    service = JoueurService()

    actions = {
        "1": action_creer_joueur,
        "2": action_ajouter_ami,
        "3": action_voir_profil,
        "4": action_update_score,
        "5": action_top_10,
        "6": action_classement_amis,
        "7": action_voir_amis,
        "8": action_amis_damis,
        "9": action_voir_inventaire,
        "10": action_ajouter_item,
        "11": action_supprimer_joueur,
        "12": action_nombre_joueurs,
    }

    while True:
        afficher_menu()
        choix = input("\nVotre choix : ").strip()

        if choix == "0":
            print("\nAu revoir !")
            service.close()
            break

        action = actions.get(choix)
        if action:
            try:
                action(service)
            except Exception as e:
                print(f"\n✗ Erreur : {e}")
        else:
            print("\nChoix invalide, réessayez.")


if __name__ == "__main__":
    main()
