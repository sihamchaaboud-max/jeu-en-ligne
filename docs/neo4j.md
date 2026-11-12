# Documentation — Partie Neo4j (relations sociales)

**Auteure :** Salma  
**Rôle dans le projet :** gérer les relations d'amitié entre joueurs avec une base orientée graphe.

---

## 1. Résumé de ce qui a été fait

1. Installation et lancement de Neo4j avec Docker Compose.
2. Conception du modèle de graphe (noeuds `Joueur`, relation `AMI_DE`).
3. Écriture du module Python `neo4j_service.py` : création de joueurs, ajout et suppression d'amis, liste des amis, amis d'amis.
4. Écriture de 9 tests automatiques (`test_neo4j.py`), tous réussis.
5. Écriture de fonctions de chargement en masse pour le jeu de données volumineux (milliers de joueurs).

---

## 2. Fichiers concernés et rôle de chacun

| Fichier | Rôle |
|---------|------|
| `docker-compose.yml` | Décrit et lance les trois bases (MongoDB, Redis, Neo4j) avec une seule commande. |
| `.env` | Contient les adresses et mots de passe des bases. **Jamais envoyé sur GitHub.** |
| `.gitignore` | Liste ce que Git doit ignorer (`.env`, `venv/`, `__pycache__/`). |
| `requirements.txt` | Liste des bibliothèques Python à installer (`neo4j`, `python-dotenv`, `pytest`, …). |
| `app/config.py` | Lit le `.env` et expose les paramètres de connexion (`NEO4J_URL`, `NEO4J_USER`, `NEO4J_PASSWORD`). |
| `app/services/neo4j_service.py` | **Fichier principal.** Toutes les opérations sur le graphe. |
| `tests/test_neo4j.py` | Vérifie automatiquement que chaque fonction se comporte correctement. |
| `scripts/seed_neo4j_demo.py` | Charge ~5 000 joueurs et ~25 000 amitiés pour simuler un fort volume. |

---

## 3. Modèle de données

```
(:Joueur {id, pseudo}) -[:AMI_DE]- (:Joueur {id, pseudo})
```

- **Noeud `Joueur`** : `id` (identifiant commun aux trois bases) et `pseudo`.
- **Relation `AMI_DE`** : stockée dans un seul sens, mais toujours lue sans direction. « A est ami de B » signifie aussi « B est ami de A ».
- **Contrainte d'unicité** sur `Joueur.id` : impossible de créer deux joueurs avec le même identifiant. Elle crée aussi un index, qui accélère les recherches.

**Lien avec les autres bases :** l'`id` du joueur est le même que le `_id` de MongoDB et le membre du sorted set de Redis. C'est ce qui permet de relier les trois bases.

---

## 4. Les fonctions de `neo4j_service.py`

| Fonction | Utilité |
|----------|---------|
| `creer_noeud(id, pseudo)` | Crée le joueur dans le graphe (ou met à jour son pseudo s'il existe). |
| `supprimer_noeud(id)` | Supprime le joueur et toutes ses amitiés. |
| `ajouter_ami(a, b)` | Crée l'amitié entre A et B, sans doublon, dans un sens ou dans l'autre. Refuse un joueur ami avec lui-même ou un joueur inexistant. |
| `supprimer_ami(a, b)` | Supprime l'amitié, quel que soit son sens. Renvoie `True` si elle existait. |
| `sont_amis(a, b)` | Indique si deux joueurs sont amis. |
| `get_amis(id)` | Liste des amis d'un joueur. |
| `get_amis_d_amis(id)` | Amis d'amis qui ne sont pas déjà amis, classés par nombre d'amis en commun. |
| `get_ids_amis(id)` | Renvoie uniquement les identifiants des amis. Utilisé par Oussama pour le classement limité aux amis (croisement avec Redis). |
| `initialiser_schema()` | Crée la contrainte d'unicité. |
| `verifier_connexion()` | Vérifie que Neo4j est joignable et que le mot de passe est correct. |
| `vider_graphe()` | Supprime tout le graphe (avant un seed). |
| `creer_noeuds_en_masse(...)` / `ajouter_amis_en_masse(...)` | Chargement par paquets de milliers de joueurs et d'amitiés. |
| `compter()` | Nombre de joueurs et d'amitiés (pour vérifier un chargement). |

---

## 5. Les requêtes Cypher utilisées

**Créer un joueur**
```cypher
MERGE (j:Joueur {id: $id}) SET j.pseudo = $pseudo
```
`MERGE` crée le noeud s'il n'existe pas, sinon le retrouve : pas de doublon.

**Ajouter une amitié (sans doublon)**
```cypher
MATCH (a:Joueur {id:$a}), (b:Joueur {id:$b})
WHERE NOT (a)-[:AMI_DE]-(b)
CREATE (a)-[:AMI_DE]->(b)
```
`WHERE NOT ...` vérifie qu'aucune amitié n'existe déjà, dans aucun sens.

**Lister les amis**
```cypher
MATCH (:Joueur {id:$id})-[:AMI_DE]-(f:Joueur)
RETURN f.id, f.pseudo ORDER BY f.pseudo
```
L'absence de flèche (`-[:AMI_DE]-`) cherche dans les deux sens.

**Amis d'amis**
```cypher
MATCH (p:Joueur {id:$id})-[:AMI_DE]-(:Joueur)-[:AMI_DE]-(fof:Joueur)
WHERE fof <> p AND NOT (p)-[:AMI_DE]-(fof)
RETURN fof.id, fof.pseudo, count(*) AS amis_communs
ORDER BY amis_communs DESC LIMIT 20
```
Deux sauts dans le graphe. `fof <> p` exclut le joueur lui-même, `NOT (p)-[:AMI_DE]-(fof)` exclut ses amis directs, `count(*)` compte les amis en commun.

**Supprimer une amitié / un joueur**
```cypher
MATCH (:Joueur {id:$a})-[r:AMI_DE]-(:Joueur {id:$b}) DELETE r
MATCH (j:Joueur {id:$id}) DETACH DELETE j
```
`DETACH DELETE` supprime le noeud avec ses relations (Neo4j refuse un simple `DELETE` si le noeud a encore des relations).

---

## 6. Commandes exécutées dans le terminal et leur utilité

### Docker

| Commande | Utilité |
|----------|---------|
| `docker --version` | Vérifier que Docker est installé. |
| `docker compose version` | Vérifier que Docker Compose est disponible. |
| `docker ps` | Lister les conteneurs **en cours d'exécution**. Permet de vérifier que `game-neo4j` est « Up ». |
| `docker ps -a` | Lister **tous** les conteneurs, y compris arrêtés. Utile pour diagnostiquer un conteneur qui s'est arrêté ou n'a jamais été créé. |
| `docker compose config` | Afficher le fichier `docker-compose.yml` tel que Docker le comprend. Détecte les erreurs d'indentation ou un fichier vide *avant* de lancer. |
| `docker compose up neo4j` | Lancer Neo4j **au premier plan** (on voit les logs). Utilisé pour le premier démarrage et le téléchargement de l'image. |
| `docker compose up -d neo4j` | Lancer Neo4j **en arrière-plan** (`-d` = detached) : le terminal reste utilisable et Neo4j continue de tourner. |
| `docker logs game-neo4j` | Afficher les messages de Neo4j. La ligne `Started.` indique qu'il est prêt. |
| `docker logs -f game-neo4j` | Même chose en suivant en direct (`-f` = follow). `Ctrl+C` pour quitter sans arrêter Neo4j. |

### PowerShell

| Commande | Utilité |
|----------|---------|
| `Get-Content docker-compose.yml` | Afficher le contenu d'un fichier pour vérifier qu'il n'est pas vide. |

### Python

| Commande | Utilité |
|----------|---------|
| `python -m venv venv` | Créer un **environnement virtuel** : un espace isolé où les bibliothèques du projet s'installent sans toucher au reste de la machine. |
| `.\venv\Scripts\Activate.ps1` | **Activer** cet environnement (le terminal affiche `(venv)`). À refaire à chaque nouveau terminal. |
| `pip install -r requirements.txt` | Installer toutes les bibliothèques listées dans `requirements.txt` (`neo4j`, `python-dotenv`, `pytest`, …). |
| `python -m pytest tests/test_neo4j.py -v` | Lancer les tests Neo4j. `-v` (verbose) affiche chaque test avec son résultat. Doit être lancé depuis la racine du projet pour que Python trouve le paquet `app`. |
| `python -m scripts.seed_neo4j_demo` | Charger le jeu de données volumineux (5 000 joueurs, ~25 000 amitiés). |

### Git

| Commande | Utilité |
|----------|---------|
| `git status` | Voir les fichiers modifiés et vérifier que `.env` n'est pas ajouté par erreur. |
| `git pull` | Récupérer le travail des coéquipiers **avant** d'envoyer le sien, pour éviter les conflits. |
| `git add <fichiers>` | Choisir les fichiers à inclure dans la sauvegarde. |
| `git commit -m "..."` | Enregistrer une version, avec un message décrivant le changement. |
| `git push` | Envoyer ses commits sur GitHub. |

---

## 7. Résultats des tests

```
tests/test_neo4j.py::test_get_amis                               PASSED
tests/test_neo4j.py::test_amitie_symetrique                      PASSED
tests/test_neo4j.py::test_ajouter_ami_sans_doublon               PASSED
tests/test_neo4j.py::test_pas_ami_avec_soi_meme                  PASSED
tests/test_neo4j.py::test_ami_inexistant                         PASSED
tests/test_neo4j.py::test_get_amis_d_amis                        PASSED
tests/test_neo4j.py::test_amis_d_amis_exclut_les_amis_directs    PASSED
tests/test_neo4j.py::test_supprimer_ami                          PASSED
tests/test_neo4j.py::test_supprimer_noeud_supprime_les_amities   PASSED
9 passed in 14.74s
```

**Ce que les tests vérifient** : la liste des amis, la symétrie de l'amitié, l'absence de doublon, le refus d'un joueur ami avec lui-même ou d'un joueur inexistant, les amis d'amis (sans les amis directs ni soi-même), la suppression d'une amitié et la suppression d'un joueur avec ses relations.

**Méthode** : chaque test part d'un petit graphe connu (`a-b`, `b-c`, `b-d`, `c-e`) créé avant le test et nettoyé après, sans toucher aux vraies données.

---

## 8. Pourquoi une base orientée graphe pour les amitiés ?

Les amitiés sont des **relations entre joueurs**, et la question « amis d'amis » est un parcours de graphe. Dans une base relationnelle, il faudrait une table d'amitiés et une auto-jointure par saut, dont le coût augmente vite avec le volume. Dans Neo4j, chaque noeud pointe directement vers ses voisins : le temps dépend du nombre de voisins parcourus, pas de la taille totale de la base. Le modèle `(joueur)-[AMI_DE]-(joueur)` correspond aussi directement à ce que l'on dessine au tableau.

**Pourquoi pas les autres bases ?** MongoDB stockerait une liste d'amis dans chaque document, mais chaque saut demanderait une requête de plus côté application. Redis n'a pas de notion de parcours.

**Théorème CAP.** Neo4j en cluster privilégie la cohérence (consensus Raft pour les écritures) : c'est un choix **CP**. Dans ce projet, une seule instance tourne, donc il n'y a pas de partitionnement à gérer.

---

## 9. Problèmes rencontrés et solutions

| Problème | Cause | Solution |
|----------|-------|----------|
| `empty compose file` | `docker-compose.yml` était vide | Écrire le contenu du fichier et l'enregistrer. |
| `failed to connect to the docker API` | Docker Desktop n'était pas démarré | Lancer Docker Desktop et attendre « Engine running ». |
| Page `localhost:7474` inaccessible | Neo4j lancé au premier plan, arrêté en reprenant le terminal | Relancer avec `docker compose up -d neo4j`. |
| `No such container: game-neo4j` | Le conteneur n'avait pas été créé | `docker compose up` puis vérification avec `docker ps -a`. |

---

## 10. Suite prévue

1. Intégrer les fonctions Neo4j dans `joueur_service.py` (création d'un joueur dans les trois bases, classement entre amis).
2. Aligner les identifiants de joueurs avec Siham (MongoDB) et Oussama (Redis).
3. Charger le jeu de données commun dans `seed_data.py`.
4. Exposer les fonctionnalités Neo4j en API REST.
5. Tester avec Postman et ajouter les captures dans `docs/captures/`.
