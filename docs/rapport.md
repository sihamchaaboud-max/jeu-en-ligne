# Rapport — Projet Jeu en Ligne NoSQL

## Présentation générale

Ce projet implémente le backend d'un jeu en ligne multijoueur en utilisant **trois bases de données NoSQL** complémentaires. Chaque base est choisie pour ses points forts selon le type de donnée à stocker.

---

## Équipe et répartition

| Membre   | Rôle                    | Base     | Module                     |
|----------|-------------------------|----------|----------------------------|
| Siham    | Profils & inventaires   | MongoDB  | `mongo_service.py`         |
| Oussama  | Scores & intégration    | Redis    | `redis_service.py` + `joueur_service.py` |
| Salma    | Réseau social           | Neo4j    | `neo4j_service.py`         |

---

## Architecture technique

```
jeu-en-ligne/
├── docker-compose.yml          ← Lance les 3 bases en conteneurs
├── .env                        ← Configuration des URLs et mots de passe
├── requirements.txt            ← Dépendances Python
│
├── app/
│   ├── config.py               ← Lecture du .env
│   ├── joueur_service.py       ← Intégration des 3 bases (Oussama)
│   ├── main.py                 ← Interface console + mode démo
│   └── services/
│       ├── mongo_service.py    ← CRUD profils + inventaires (Siham)
│       ├── redis_service.py    ← Scores + classements (Oussama)
│       └── neo4j_service.py    ← Graphe d'amitiés (Salma)
│
├── scripts/
│   └── seed_data.py            ← 10 joueurs, scores, amitiés de test
│
└── tests/
    ├── test_mongo.py           ← 12 tests MongoDB
    ├── test_redis.py           ← 13 tests Redis
    └── test_neo4j.py           ← 11 tests Neo4j
```

---

## Choix des bases de données

### MongoDB — Profils & Inventaires (Siham)

**Pourquoi MongoDB ?**
Les profils joueurs ont une structure variable (inventaire de taille dynamique, attributs optionnels). MongoDB stocke les documents JSON nativement, ce qui évite les jointures et permet d'évoluer le schéma facilement.

**Structure d'un document joueur :**
```json
{
  "_id": "j1",
  "pseudo": "Oussama",
  "niveau": 10,
  "inventaire": [
    { "objet": "épée",   "qte": 1 },
    { "objet": "potion", "qte": 3 }
  ]
}
```

**Opérations implémentées :**
- `creer_profil()` — insertion d'un nouveau joueur
- `get_profil()` / `get_pseudo()` — lecture
- `ajouter_objet()` / `retirer_objet()` — gestion de l'inventaire avec `$inc` et `$pull`
- `modifier_niveau()` — mise à jour avec `$set`
- `joueur_existe()` / `lister_joueurs()` — utilitaires

---

### Redis — Scores & Classements (Oussama)

**Pourquoi Redis ?**
Redis est une base en mémoire ultra-rapide. Sa structure **Sorted Set** est faite pour les classements : elle stocke les membres avec un score et les trie automatiquement. Les opérations de classement sont en O(log n).

**Structure utilisée :**
```
Clé : "classement_global"
Type : Sorted Set
  member = joueur_id
  score  = points du joueur
```

**Opérations implémentées :**
- `set_score()` — `ZADD`
- `get_top_10()` — `ZREVRANGE ... WITHSCORES` (top 10 décroissant)
- `get_rang()` — `ZREVRANK` (rang 1 = meilleur)
- `increment_score()` — `ZINCRBY`
- `get_scores_pour_ids()` — `ZMSCORE` (scores de plusieurs joueurs en 1 commande)

---

### Neo4j — Réseau d'amitié (Salma)

**Pourquoi Neo4j ?**
Les relations d'amitié forment un graphe. Les bases relationnelles nécessitent des auto-jointures coûteuses pour les requêtes de type "amis d'amis". Neo4j traverse ce graphe nativement avec Cypher.

**Modèle de graphe :**
```
(:Joueur {id, pseudo}) -[:AMI_DE]- (:Joueur)
```

**Requêtes Cypher clés :**

Amis directs :
```cypher
MATCH (:Joueur {id: $id})-[:AMI_DE]-(f:Joueur)
RETURN f.id, f.pseudo
```

Amis d'amis (non encore amis, triés par amis communs) :
```cypher
MATCH (p:Joueur {id: $id})-[:AMI_DE]-(:Joueur)-[:AMI_DE]-(fof:Joueur)
WHERE fof <> p AND NOT (p)-[:AMI_DE]-(fof)
RETURN fof.id, fof.pseudo, count(*) AS amis_communs
ORDER BY amis_communs DESC
```

---

## Intégration des 3 bases — JoueurService (Oussama)

Le `JoueurService` orchestre les 3 bases pour les opérations qui les combinent :

### `creer_joueur(id, pseudo, niveau, score)`
```
MongoDB  ← creer_profil(id, pseudo, niveau)
Redis    ← set_score(id, score)
Neo4j    ← creer_noeud(id, pseudo)
```

### `get_top_10_global()`
```
Redis   → get_top_10()           → [(id, score), ...]
MongoDB → get_pseudo(id)         → noms pour l'affichage
Résultat : [{"rang", "id", "nom", "score"}, ...]
```

### `get_classement_amis(joueur_id)`
```
Neo4j   → get_ids_amis(joueur_id)       → [id1, id2, ...]
         + joueur_id lui-même
Redis   → get_scores_pour_ids([ids])    → triés par score desc
MongoDB → get_pseudo(id)               → noms pour l'affichage
```

---

## Résultats des tests

```
pytest tests/ -v

tests/test_mongo.py   12 tests  ✅ PASSED
tests/test_neo4j.py   11 tests  ✅ PASSED
tests/test_redis.py   13 tests  ✅ PASSED

======================== 36 passed in 3.78s ========================
```

---

## Instructions pour lancer le projet

### 1. Démarrer les bases
```bash
docker compose up -d
```

### 2. Installer les dépendances Python
```bash
pip install -r requirements.txt
```

### 3. Insérer les données de test
```bash
python -m scripts.seed_data
```

### 4. Lancer l'interface interactive
```bash
python -m app.main
```

### 5. Lancer la démo automatique (pour la présentation)
```bash
python -m app.main --demo
```

### 6. Lancer les tests
```bash
python -m pytest tests/ -v
```

---

## Données de test (seed_data.py)

10 joueurs créés dans les 3 bases :

| ID  | Pseudo  | Niveau | Score |
|-----|---------|--------|-------|
| j1  | Oussama | 10     | 8500  |
| j2  | Siham   | 8      | 7200  |
| j3  | Yassine | 7      | 6800  |
| j4  | Salma   | 9      | 9100  |
| j5  | Mehdi   | 5      | 4200  |
| j6  | Anas    | 6      | 5500  |
| j7  | Imane   | 4      | 3100  |
| j8  | Karim   | 3      | 2400  |
| j9  | Nada    | 7      | 6600  |
| j10 | Hamza   | 5      | 4800  |

Réseau d'amitiés (12 relations dans Neo4j) :
j1-j2, j1-j3, j1-j5, j2-j4, j2-j6, j3-j7, j3-j9, j4-j8, j5-j10, j6-j7, j8-j9, j9-j10

---

## Technologies utilisées

| Technologie  | Version | Rôle                    |
|--------------|---------|-------------------------|
| Python       | 3.14    | Langage principal        |
| MongoDB      | 7       | Documents / profils      |
| Redis        | 7       | Scores / classements     |
| Neo4j        | 5       | Graphe / amitiés         |
| pymongo      | 4.19    | Driver MongoDB           |
| redis-py     | 8.1     | Driver Redis             |
| neo4j-python | 6.4     | Driver Neo4j             |
| python-dotenv| 1.0     | Configuration            |
| pytest       | 9.2     | Tests unitaires          |
| Docker       | —       | Conteneurs des bases     |
