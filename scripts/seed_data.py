from app.services import mongo_service as m

JOUEURS = [
    ("p1",  "Sara",    5, [("épée", 1), ("potion", 3)]),
    ("p2",  "Yassine", 8, [("arc", 1), ("flèche", 20)]),
    ("p3",  "Imane",   3, [("bouclier", 1)]),
    ("p4",  "Omar",   12, [("épée", 1), ("armure", 1), ("potion", 5)]),
    ("p5",  "Lina",    7, [("baguette", 1), ("potion", 2)]),
    ("p6",  "Adam",    4, [("hache", 1)]),
    ("p7",  "Nour",   10, [("arc", 1), ("potion", 4)]),
    ("p8",  "Hamza",   2, []),
    ("p9",  "Salma",   9, [("épée", 1), ("bouclier", 1)]),
    ("p10", "Rayan",   6, [("potion", 10)]),
]


def seed_mongo():
    for player_id, pseudo, niveau, objets in JOUEURS:
        m.supprimer_profil(player_id)          # évite les doublons si on relance
        m.creer_profil(player_id, pseudo, niveau)
        for objet, qte in objets:
            m.ajouter_objet(player_id, objet, qte)
    print(len(JOUEURS), "joueurs créés dans MongoDB")


if __name__ == "__main__":
    seed_mongo()