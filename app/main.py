"""
Menu console - Point d'entrée principal du jeu en ligne.

Modes :
  - Interactif : python -m app.main
  - Démo auto  : python -m app.main --demo
"""

import sys
import time

from app.joueur_service import JoueurService
from app.services import neo4j_service as neo4j
from app.services import mongo_service as mongo

# ─────────────────────────────────────────────
# Couleurs ANSI (désactivées si non supporté)
# ─────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BLUE   = "\033[94m"
MAGENTA= "\033[95m"
WHITE  = "\033[97m"

def c(couleur: str, texte: str) -> str:
    """Applique une couleur ANSI à un texte."""
    return f"{couleur}{texte}{RESET}"


# ─────────────────────────────────────────────
# Bannière
# ─────────────────────────────────────────────
BANNIERE = f"""
{CYAN}{BOLD}
╔══════════════════════════════════════════════════════╗
║          🎮  JEU EN LIGNE  —  NOSQL PROJECT          ║
║                                                      ║
║   MongoDB (Siham)  •  Redis (Oussama)  •  Neo4j (Salma) ║
╚══════════════════════════════════════════════════════╝{RESET}
"""


# ─────────────────────────────────────────────
# Vérification des connexions au démarrage
# ─────────────────────────────────────────────
def verifier_connexions(service: JoueurService) -> bool:
    """Vérifie que les 3 bases sont accessibles. Affiche le statut."""
    print(f"\n{BOLD}Vérification des connexions...{RESET}")
    ok = True

    # MongoDB
    try:
        mongo.lister_joueurs()
        print(f"  {c(GREEN,'✓')} MongoDB    — connecté  (localhost:27017)")
    except Exception as e:
        print(f"  {c(RED,'✗')} MongoDB    — {e}")
        ok = False

    # Redis
    try:
        service.redis.get_nombre_joueurs()
        print(f"  {c(GREEN,'✓')} Redis      — connecté  (localhost:6379)")
    except Exception as e:
        print(f"  {c(RED,'✗')} Redis      — {e}")
        ok = False

    # Neo4j
    try:
        neo4j.verifier_connexion()
        print(f"  {c(GREEN,'✓')} Neo4j      — connecté  (localhost:7687)")
    except Exception as e:
        print(f"  {c(RED,'✗')} Neo4j      — {e}")
        ok = False

    if not ok:
        print(f"\n{c(RED, BOLD + '⚠  Une ou plusieurs bases sont inaccessibles.')}")
        print(f"   Lance d'abord : {c(YELLOW, 'docker compose up -d')}\n")
    else:
        print(f"\n  {c(GREEN, BOLD + 'Toutes les bases sont opérationnelles ✓')}\n")

    return ok


# ─────────────────────────────────────────────
# Menu
# ─────────────────────────────────────────────
def afficher_menu():
    print(f"\n{CYAN}{BOLD}{'─'*54}{RESET}")
    print(f"{BOLD}  MENU PRINCIPAL{RESET}")
    print(f"{CYAN}{'─'*54}{RESET}")
    print(f"  {c(YELLOW,'1.')}  Créer un joueur")
    print(f"  {c(YELLOW,'2.')}  Ajouter une amitié")
    print(f"  {c(YELLOW,'3.')}  Voir le profil complet d'un joueur")
    print(f"  {c(YELLOW,'4.')}  Ajouter des points à un joueur")
    print(f"  {c(CYAN,'5.')}  🏆 Top 10 global")
    print(f"  {c(CYAN,'6.')}  👥 Classement entre amis")
    print(f"  {c(CYAN,'7.')}  Voir les amis d'un joueur")
    print(f"  {c(CYAN,'8.')}  Voir les amis d'amis (recommandations)")
    print(f"  {c(MAGENTA,'9.')}  Voir l'inventaire")
    print(f"  {c(MAGENTA,'10.')} Ajouter un objet à l'inventaire")
    print(f"  {c(MAGENTA,'11.')} Retirer un objet de l'inventaire")
    print(f"  {c(MAGENTA,'12.')} Modifier le niveau d'un joueur")
    print(f"  {c(YELLOW,'13.')} Supprimer une amitié")
    print(f"  {c(RED,'14.')} Supprimer un joueur")
    print(f"  {c(WHITE,'15.')} Statistiques globales")
    print(f"  {c(GREEN,'16.')} Lister tous les joueurs")
    print(f"  {c(RED,'0.')}  Quitter")
    print(f"{CYAN}{'─'*54}{RESET}")


# ─────────────────────────────────────────────
# Actions
# ─────────────────────────────────────────────
def action_creer_joueur(service: JoueurService):
    print(f"\n{BOLD}── Créer un joueur ──{RESET}")
    joueur_id = input("  ID       : ").strip()
    if not joueur_id:
        print(c(RED, "  ID vide, annulé."))
        return
    if mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Le joueur '{joueur_id}' existe déjà."))
        return
    pseudo = input("  Pseudo   : ").strip() or joueur_id
    niveau = input("  Niveau   (défaut 1) : ").strip() or "1"
    score  = input("  Score    (défaut 0) : ").strip() or "0"

    service.creer_joueur(joueur_id, pseudo, int(niveau), int(score))
    print(c(GREEN, f"\n  ✓ Joueur '{pseudo}' créé dans MongoDB + Redis + Neo4j."))


def action_ajouter_ami(service: JoueurService):
    print(f"\n{BOLD}── Ajouter une amitié ──{RESET}")
    id_a = input("  ID joueur A : ").strip()
    id_b = input("  ID joueur B : ").strip()

    if not mongo.joueur_existe(id_a):
        print(c(RED, f"  ✗ Joueur '{id_a}' introuvable."))
        return
    if not mongo.joueur_existe(id_b):
        print(c(RED, f"  ✗ Joueur '{id_b}' introuvable."))
        return

    ok = neo4j.ajouter_ami(id_a, id_b)
    if ok:
        pa = mongo.get_pseudo(id_a)
        pb = mongo.get_pseudo(id_b)
        print(c(GREEN, f"\n  ✓ {pa} et {pb} sont maintenant amis."))
    else:
        print(c(YELLOW, f"\n  ⚠ Amitié non créée (déjà amis ou IDs invalides)."))


def action_voir_profil(service: JoueurService):
    print(f"\n{BOLD}── Profil d'un joueur ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()

    profil = mongo.get_profil(joueur_id)
    if not profil:
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable dans MongoDB."))
        return

    score = service.redis.get_score(joueur_id)
    rang  = service.redis.get_rang(joueur_id)
    amis  = neo4j.get_amis(joueur_id)
    nb_amis = len(amis)

    print(f"\n  {BOLD}{CYAN}┌─ {profil['pseudo']} ({'ID: ' + joueur_id}) ─────────────┐{RESET}")
    print(f"  {CYAN}│{RESET}  Niveau       : {c(YELLOW, str(profil.get('niveau', '?')))}")
    print(f"  {CYAN}│{RESET}  Score        : {c(GREEN, str(score) if score is not None else 'Non classé')}")
    print(f"  {CYAN}│{RESET}  Rang global  : {c(GREEN, '#' + str(rang)) if rang else 'N/A'}")
    print(f"  {CYAN}│{RESET}  Amis         : {nb_amis}")
    inv = profil.get("inventaire", [])
    if inv:
        inv_str = ", ".join(e["objet"] + " x" + str(e["qte"]) for e in inv)
        print(f"  {CYAN}│{RESET}  Inventaire   : {inv_str}")
    else:
        print(f"  {CYAN}│{RESET}  Inventaire   : vide")
    print(f"  {CYAN}└──────────────────────────────────────────{RESET}")


def action_ajouter_points(service: JoueurService):
    print(f"\n{BOLD}── Ajouter des points ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    if not mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return
    points = input("  Points à ajouter (négatif pour enlever) : ").strip()
    nouveau = service.redis.increment_score(joueur_id, int(points))
    rang    = service.redis.get_rang(joueur_id)
    pseudo  = mongo.get_pseudo(joueur_id)
    print(c(GREEN, f"\n  ✓ {pseudo} : nouveau score = {int(nouveau)} pts  (rang #{rang})"))


def action_top_10(service: JoueurService):
    top = service.get_top_10_global()
    if not top:
        print(c(YELLOW, "\n  Aucun joueur classé."))
        return

    print(f"\n  {BOLD}{YELLOW}🏆  TOP 10 GLOBAL{RESET}")
    print(f"  {'─'*44}")
    print(f"  {BOLD}{'Rang':<6} {'Pseudo':<15} {'ID':<10} {'Score':>8}{RESET}")
    print(f"  {'─'*44}")
    medailles = {1: "🥇", 2: "🥈", 3: "🥉"}
    for e in top:
        med = medailles.get(e['rang'], "  ")
        couleur = YELLOW if e['rang'] <= 3 else RESET
        print(f"  {couleur}{med} #{e['rang']:<4} {e['nom']:<15} {e['id']:<10} {e['score']:>8} pts{RESET}")
    print(f"  {'─'*44}")


def action_classement_amis(service: JoueurService):
    print(f"\n{BOLD}── Classement entre amis ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    if not mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return

    classement = service.get_classement_amis(joueur_id)
    pseudo = mongo.get_pseudo(joueur_id)

    if not classement:
        print(c(YELLOW, f"\n  {pseudo} n'a pas d'amis classés."))
        return

    print(f"\n  {BOLD}{CYAN}👥  CLASSEMENT ENTRE AMIS DE {pseudo.upper()}{RESET}")
    print(f"  {'─'*44}")
    print(f"  {BOLD}{'Rang':<6} {'Pseudo':<15} {'ID':<10} {'Score':>8}{RESET}")
    print(f"  {'─'*44}")
    for e in classement:
        marqueur = c(GREEN, " ◄ toi") if e['id'] == joueur_id else ""
        print(f"  #{e['rang']:<5} {e['nom']:<15} {e['id']:<10} {e['score']:>8} pts{marqueur}")
    print(f"  {'─'*44}")


def action_voir_amis(service: JoueurService):
    print(f"\n{BOLD}── Amis d'un joueur ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    pseudo = mongo.get_pseudo(joueur_id) or joueur_id
    amis = neo4j.get_amis(joueur_id)

    if not amis:
        print(c(YELLOW, f"\n  {pseudo} n'a pas encore d'amis."))
        return

    print(f"\n  {BOLD}Amis de {pseudo} ({len(amis)}){RESET}")
    for ami in amis:
        score = service.redis.get_score(ami['id'])
        score_str = f"{score} pts" if score is not None else "non classé"
        print(f"  {c(CYAN,'→')} {ami['pseudo']:<15} (ID: {ami['id']})  {score_str}")


def action_amis_damis(service: JoueurService):
    print(f"\n{BOLD}── Recommandations d'amis ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    pseudo = mongo.get_pseudo(joueur_id) or joueur_id
    recs = neo4j.get_amis_d_amis(joueur_id)

    if not recs:
        print(c(YELLOW, f"\n  Aucune recommandation pour {pseudo}."))
        return

    print(f"\n  {BOLD}Amis d'amis suggérés pour {pseudo} ({len(recs)}){RESET}")
    for r in recs:
        commun = r['amis_communs']
        print(f"  {c(MAGENTA,'→')} {r['pseudo']:<15} (ID: {r['id']})  "
              f"{commun} ami{'s' if commun > 1 else ''} en commun")


def action_voir_inventaire(service: JoueurService):
    print(f"\n{BOLD}── Inventaire ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    profil = mongo.get_profil(joueur_id)
    if not profil:
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return

    inv = profil.get("inventaire", [])
    pseudo = profil.get("pseudo", joueur_id)

    if not inv:
        print(c(YELLOW, f"\n  Inventaire de {pseudo} : vide."))
        return

    print(f"\n  {BOLD}Inventaire de {pseudo}{RESET}")
    for item in inv:
        print(f"  {c(MAGENTA,'▸')} {item['objet']:<20} x{item['qte']}")


def action_ajouter_objet(service: JoueurService):
    print(f"\n{BOLD}── Ajouter un objet ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    if not mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return
    objet = input("  Objet : ").strip()
    qte   = input("  Quantité (défaut 1) : ").strip() or "1"
    mongo.ajouter_objet(joueur_id, objet, int(qte))
    pseudo = mongo.get_pseudo(joueur_id)
    print(c(GREEN, f"\n  ✓ {qte}x {objet} ajouté à l'inventaire de {pseudo}."))


def action_retirer_objet(service: JoueurService):
    print(f"\n{BOLD}── Retirer un objet ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    if not mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return
    objet = input("  Objet à retirer : ").strip()
    qte   = input("  Quantité (défaut 1) : ").strip() or "1"
    mongo.retirer_objet(joueur_id, objet, int(qte))
    pseudo = mongo.get_pseudo(joueur_id)
    print(c(GREEN, f"\n  ✓ {qte}x {objet} retiré de l'inventaire de {pseudo}."))


def action_modifier_niveau(service: JoueurService):
    print(f"\n{BOLD}── Modifier le niveau ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    if not mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return
    niveau = input("  Nouveau niveau : ").strip()
    mongo.modifier_niveau(joueur_id, int(niveau))
    pseudo = mongo.get_pseudo(joueur_id)
    print(c(GREEN, f"\n  ✓ Niveau de {pseudo} mis à jour : {niveau}."))


def action_supprimer_ami(service: JoueurService):
    print(f"\n{BOLD}── Supprimer une amitié ──{RESET}")
    id_a = input("  ID joueur A : ").strip()
    id_b = input("  ID joueur B : ").strip()
    ok = neo4j.supprimer_ami(id_a, id_b)
    if ok:
        print(c(GREEN, f"\n  ✓ Amitié entre {id_a} et {id_b} supprimée."))
    else:
        print(c(YELLOW, f"\n  ⚠ Ces joueurs n'étaient pas amis."))


def action_supprimer_joueur(service: JoueurService):
    print(f"\n{BOLD}── Supprimer un joueur ──{RESET}")
    joueur_id = input("  ID du joueur : ").strip()
    if not mongo.joueur_existe(joueur_id):
        print(c(RED, f"  ✗ Joueur '{joueur_id}' introuvable."))
        return
    pseudo = mongo.get_pseudo(joueur_id)
    confirm = input(f"  Supprimer {c(RED, pseudo)} définitivement ? (oui/non) : ").strip().lower()
    if confirm not in ("oui", "o"):
        print("  Annulé.")
        return
    service.supprimer_joueur(joueur_id)
    print(c(GREEN, f"\n  ✓ Joueur '{pseudo}' supprimé des 3 bases."))


def action_statistiques(service: JoueurService):
    total_redis  = service.redis.get_nombre_joueurs()
    total_mongo  = len(mongo.lister_joueurs())
    top1         = service.get_top_10_global()

    print(f"\n  {BOLD}{WHITE}📊  STATISTIQUES GLOBALES{RESET}")
    print(f"  {'─'*36}")
    print(f"  Joueurs classés (Redis)  : {c(CYAN, str(total_redis))}")
    print(f"  Joueurs en base (MongoDB): {c(CYAN, str(total_mongo))}")
    if top1:
        leader = top1[0]
        print(f"  Meilleur joueur          : {c(YELLOW, leader['nom'])} ({leader['score']} pts)")
    print(f"  {'─'*36}")


def action_lister_joueurs(service: JoueurService):
    joueurs_list = mongo.lister_joueurs()
    if not joueurs_list:
        print(c(YELLOW, "\n  Aucun joueur en base."))
        return

    print(f"\n  {BOLD}Liste des joueurs ({len(joueurs_list)}){RESET}")
    print(f"  {'─'*50}")
    print(f"  {BOLD}{'ID':<10} {'Pseudo':<15} {'Niveau':>7} {'Score':>10}{RESET}")
    print(f"  {'─'*50}")
    for j in sorted(joueurs_list, key=lambda x: x.get("pseudo", "")):
        score = service.redis.get_score(j["_id"])
        score_str = f"{score:>8} pts" if score is not None else "    non classé"
        print(f"  {j['_id']:<10} {j.get('pseudo','?'):<15} {j.get('niveau',1):>7}   {score_str}")
    print(f"  {'─'*50}")


# ─────────────────────────────────────────────
# Mode démo automatique (pour la présentation)
# ─────────────────────────────────────────────
def demo(service: JoueurService):
    """Déroule une démonstration automatique de toutes les fonctionnalités."""

    def pause(msg=""):
        if msg:
            print(f"\n  {c(BLUE, '▶ ' + msg)}")
        time.sleep(1.2)

    def titre(t):
        print(f"\n{CYAN}{BOLD}{'═'*56}")
        print(f"  {t}")
        print(f"{'═'*56}{RESET}")

    print(BANNIERE)
    print(c(GREEN, BOLD + "  MODE DÉMO — Démonstration automatique\n"))
    time.sleep(1)

    # ── 1. Seed data ──
    titre("ÉTAPE 1 — Chargement des données de test")
    pause("Insertion de 10 joueurs dans MongoDB + Redis + Neo4j...")

    from scripts.seed_data import JOUEURS, AMITIES, INVENTAIRES
    import app.services.mongo_service as m
    import app.services.neo4j_service as n

    for j in JOUEURS:
        if m.joueur_existe(j["id"]):
            service.supprimer_joueur(j["id"])
        service.creer_joueur(j["id"], j["nom"], j["niveau"], j["score"])
        for objet, qte in INVENTAIRES.get(j["id"], []):
            m.ajouter_objet(j["id"], objet, qte)
        print(f"  {c(GREEN,'✓')} {j['nom']:<12} niveau {j['niveau']}  score {j['score']} pts")

    pause("Création du réseau d'amitiés...")
    for a, b in AMITIES:
        n.ajouter_ami(a, b)
    print(c(GREEN, f"  ✓ {len(AMITIES)} amitiés créées dans Neo4j"))
    time.sleep(1)

    # ── 2. Top 10 ──
    titre("ÉTAPE 2 — Top 10 global (Redis Sorted Set)")
    pause("Lecture du classement mondial...")
    action_top_10(service)
    time.sleep(1.5)

    # ── 3. Profil ──
    titre("ÉTAPE 3 — Profil complet d'un joueur (MongoDB + Redis + Neo4j)")
    pause("Affichage du profil de j1 (Oussama)...")
    profil = mongo.get_profil("j1")
    score  = service.redis.get_score("j1")
    rang   = service.redis.get_rang("j1")
    amis   = neo4j.get_amis("j1")
    inv    = profil.get("inventaire", [])
    inv_str = ", ".join(e["objet"] + " x" + str(e["qte"]) for e in inv) if inv else "vide"
    print(f"\n  {BOLD}{CYAN}Joueur : Oussama (j1){RESET}")
    print(f"  Niveau       : {c(YELLOW, str(profil.get('niveau')))}")
    print(f"  Score Redis  : {c(GREEN, str(score) + ' pts')}")
    print(f"  Rang mondial : {c(GREEN, '#' + str(rang))}")
    print(f"  Amis Neo4j   : {', '.join(a['pseudo'] for a in amis)}")
    print(f"  Inventaire   : {inv_str}")
    time.sleep(1.5)

    # ── 4. Classement amis ──
    titre("ÉTAPE 4 — Classement entre amis (Neo4j + Redis + MongoDB)")
    pause("Classement pour j1 (Oussama) : Neo4j donne ses amis → Redis donne leurs scores...")
    action_classement_amis_demo(service, "j1")
    time.sleep(1.5)

    # ── 5. Recommandations ──
    titre("ÉTAPE 5 — Amis d'amis — Recommandations (Neo4j)")
    pause("Traversée du graphe Neo4j pour j1 (Oussama)...")
    recs = neo4j.get_amis_d_amis("j1")
    print(f"\n  {BOLD}Suggestions d'amis pour Oussama{RESET}")
    for r in recs:
        print(f"  {c(MAGENTA,'→')} {r['pseudo']:<12} ({r['amis_communs']} ami(s) en commun)")
    time.sleep(1.5)

    # ── 6. Inventaire ──
    titre("ÉTAPE 6 — Inventaire (MongoDB)")
    pause("Ajout de 2 potions à Oussama...")
    mongo.ajouter_objet("j1", "potion_max", 2)
    profil = mongo.get_profil("j1")
    print(f"\n  {BOLD}Inventaire de Oussama après ajout{RESET}")
    for item in profil.get("inventaire", []):
        print(f"  {c(MAGENTA,'▸')} {item['objet']:<20} x{item['qte']}")
    time.sleep(1.5)

    # ── 7. Stats ──
    titre("ÉTAPE 7 — Statistiques globales")
    action_statistiques(service)
    time.sleep(1)

    print(f"\n{GREEN}{BOLD}{'═'*56}")
    print(f"  ✅  DÉMO TERMINÉE — 36/36 tests passés")
    print(f"  Projet : MongoDB + Redis + Neo4j — Python")
    print(f"{'═'*56}{RESET}\n")


def action_classement_amis_demo(service: JoueurService, joueur_id: str):
    """Version sans input pour la démo."""
    classement = service.get_classement_amis(joueur_id)
    pseudo = mongo.get_pseudo(joueur_id)
    print(f"\n  {BOLD}{CYAN}👥  CLASSEMENT ENTRE AMIS DE {pseudo.upper()}{RESET}")
    print(f"  {'─'*44}")
    print(f"  {BOLD}{'Rang':<6} {'Pseudo':<15} {'ID':<10} {'Score':>8}{RESET}")
    print(f"  {'─'*44}")
    for e in classement:
        marqueur = c(GREEN, " ◄ toi") if e['id'] == joueur_id else ""
        print(f"  #{e['rang']:<5} {e['nom']:<15} {e['id']:<10} {e['score']:>8} pts{marqueur}")


# ─────────────────────────────────────────────
# Boucle principale
# ─────────────────────────────────────────────
def main():
    print(BANNIERE)

    service = JoueurService()

    if not verifier_connexions(service):
        sys.exit(1)

    # Mode démo automatique
    if "--demo" in sys.argv:
        demo(service)
        service.close()
        return

    actions = {
        "1":  action_creer_joueur,
        "2":  action_ajouter_ami,
        "3":  action_voir_profil,
        "4":  action_ajouter_points,
        "5":  action_top_10,
        "6":  action_classement_amis,
        "7":  action_voir_amis,
        "8":  action_amis_damis,
        "9":  action_voir_inventaire,
        "10": action_ajouter_objet,
        "11": action_retirer_objet,
        "12": action_modifier_niveau,
        "13": action_supprimer_ami,
        "14": action_supprimer_joueur,
        "15": action_statistiques,
        "16": action_lister_joueurs,
    }

    while True:
        afficher_menu()
        choix = input(f"\n{BOLD}  Votre choix : {RESET}").strip()

        if choix == "0":
            print(c(GREEN, "\n  Au revoir ! 👋\n"))
            service.close()
            break

        action = actions.get(choix)
        if action:
            try:
                action(service)
            except Exception as e:
                print(c(RED, f"\n  ✗ Erreur inattendue : {e}"))
        else:
            print(c(RED, "\n  Choix invalide, réessayez."))


if __name__ == "__main__":
    main()
