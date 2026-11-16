import random
import time

NB_QUESTIONS = 10     # nombre de questions par partie
TEMPS_LIMITE = 10     # secondes par question
POINTS_BASE = 10      # points pour une bonne réponse


def generer_question():
    """Crée une question au hasard et sa bonne réponse."""
    operation = random.choice(["+", "-", "×"])

    if operation == "+":
        a, b = random.randint(1, 50), random.randint(1, 50)
        reponse = a + b
    elif operation == "-":
        a = random.randint(10, 99)
        b = random.randint(1, a)          # b <= a : pas de résultat négatif
        reponse = a - b
    else:
        a, b = random.randint(2, 12), random.randint(2, 12)
        reponse = a * b

    return {"texte": f"{a} {operation} {b}", "reponse": reponse}


def verifier_reponse(question, saisie):
    """True si la saisie du joueur est la bonne réponse."""
    try:
        return int(saisie) == question["reponse"]
    except ValueError:                    # le joueur a écrit autre chose qu'un nombre
        return False


def calculer_points(correct, temps_mis):
    """Plus on répond vite, plus on gagne de points."""
    if not correct or temps_mis > TEMPS_LIMITE:
        return 0
    return POINTS_BASE + int(TEMPS_LIMITE - temps_mis)


class Partie:
    """Une partie de quiz pour un joueur. Le chrono est géré ici (côté serveur)."""

    def __init__(self, joueur_id):
        self.joueur_id = joueur_id
        self.numero = 0                   # numéro de la question en cours
        self.score = 0
        self.question = None
        self.heure_question = None

    @property
    def terminee(self):
        return self.numero >= NB_QUESTIONS and self.question is None

    def question_suivante(self):
        """Pose la question suivante, ou renvoie None si la partie est finie."""
        if self.numero >= NB_QUESTIONS:
            return None
        self.question = generer_question()
        self.numero += 1
        self.heure_question = time.time()  # on note l'heure d'envoi
        return self.question["texte"]

    def repondre(self, saisie):
        """Vérifie la réponse, mesure le temps, calcule les points."""
        temps_mis = time.time() - self.heure_question
        correct = verifier_reponse(self.question, saisie)
        points = calculer_points(correct, temps_mis)
        self.score += points
        bonne_reponse = self.question["reponse"]
        self.question = None
        return {
            "correct": correct,
            "points": points,
            "temps": round(temps_mis, 1),
            "bonne_reponse": bonne_reponse,
        }

    # ─────────────────────────────────────────────
    # Sérialisation (la partie vit dans Redis, pas en mémoire)
    # ─────────────────────────────────────────────
    def to_dict(self) -> dict:
        """État complet de la partie, prêt pour JSON."""
        return {
            "joueur_id": self.joueur_id,
            "numero": self.numero,
            "score": self.score,
            "question": self.question,
            "heure_question": self.heure_question,
        }

    @classmethod
    def from_dict(cls, donnees: dict) -> "Partie":
        """Reconstruit une Partie depuis son état sérialisé."""
        partie = cls(donnees["joueur_id"])
        partie.numero = donnees["numero"]
        partie.score = donnees["score"]
        partie.question = donnees["question"]
        partie.heure_question = donnees["heure_question"]
        return partie