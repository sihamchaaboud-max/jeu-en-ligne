from app.services import mongo_service as m

m.supprimer_profil("p1")  # nettoyage si déjà créé

m.creer_profil("p1", "Sara", niveau=5)
m.ajouter_objet("p1", "épée", 1)
m.ajouter_objet("p1", "potion", 3)
m.ajouter_objet("p1", "potion", 2)   # potion passe à 5

print(m.get_profil("p1"))
m.modifier_niveau("p1", 6)
m.retirer_objet("p1", "potion", 2)    # potion : 5 -> 3
m.retirer_objet("p1", "épée", 1)      # épée : 1 -> 0, donc supprimée

print(m.get_profil("p1"))
print(m.joueur_existe("p1"))          # True
print(len(m.lister_joueurs()), "joueur(s)")