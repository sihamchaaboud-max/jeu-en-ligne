# Jeu en Ligne

[![CI](https://github.com/sihamchaaboud-max/jeu-en-ligne/actions/workflows/ci.yml/badge.svg)](https://github.com/sihamchaaboud-max/jeu-en-ligne/actions/workflows/ci.yml)

Projet de jeu en ligne multi-joueurs utilisant trois bases de données NoSQL :
- **MongoDB** : profils des joueurs et inventaires (+ mots de passe hashés)
- **Redis** : scores et classements (Top 10 global, classement entre amis), **sessions de quiz**
- **Neo4j** : relations d'amitié et recommandations (amis d'amis)

## Répartition du travail

| Personne  | Base    | Module                  | Responsabilités |
|-----------|---------|-------------------------|-----------------|
| Personne 1| MongoDB | `mongo_service.py`     | Profils + inventaires |
| Oussama   | Redis   | `redis_service.py`     | Scores + Top 10 + classement amis + intégration |
| Personne 3| Neo4j   | `neo4j_service.py`     | Amis + amis d'amis |

## Architecture

```
jeu-en-ligne/
├── docker-compose.yml        # Lance MongoDB + Redis + Neo4j
├── requirements.txt          # pymongo, redis, neo4j, python-dotenv, pytest
├── .env                      # URLs et mots de passe des bases
│
├── app/
│   ├── config.py             # Lit le .env (URL des 3 bases)
│   ├── main.py               # Menu console pour tester toutes les fonctions
│   ├── joueur_service.py     # Intégration : creer_joueur(), classement amis
│   └── services/
│       ├── mongo_service.py  # MongoDB : profils + inventaires
│       ├── redis_service.py  # Redis : scores + top 10
│       └── neo4j_service.py  # Neo4j : amis + amis d'amis
│
├── scripts/
│   └── seed_data.py          # 10 joueurs, amitiés, scores de test
│
├── tests/
│   ├── test_mongo.py
│   ├── test_redis.py
│   └── test_neo4j.py
│
└── docs/
    └── rapport.md
```

## Prérequis

- Python 3.11+
- Docker et Docker Compose

## Installation

### 1. Lancer les bases de données

```bash
docker-compose up -d
```

Cela démarre :
- MongoDB sur `localhost:27017`
- Redis sur `localhost:6379`
- Neo4j sur `localhost:7474` (web) et `localhost:7687` (Bolt)

### 2. Installer les dépendances Python

```bash
pip install -r requirements.txt
```

### 3. Insérer les données de test (optionnel)

```bash
python -m scripts.seed_data
```

Crée 10 joueurs avec des scores et un réseau d'amitiés.

## Utilisation

### Tout-en-un avec Docker (recommandé)

```bash
docker compose up -d --build
```

Lance les 3 bases de données **et l'API** : http://localhost:8000 (dashboard), http://localhost:8000/docs (Swagger). L'API démarre dès que les bases sont prêtes (healthchecks + attente au démarrage).

### Ou en développement local

```bash
docker compose up -d mongodb redis neo4j   # bases seulement
pip install -r requirements.txt
python -m uvicorn app.api:app --reload --port 8000
```

### API web

- **Dashboard** : http://localhost:8000 — joueurs, classement, réseau d'amis, quiz
- **WebSocket** `ws://localhost:8000/ws/top10` : le Top 10 se met à jour en direct à chaque changement de score

### Authentification (quiz)

Les joueurs créés via le dashboard peuvent avoir un mot de passe (champ optionnel) :
- avec mot de passe → connexion obligatoire pour jouer au quiz (`POST /api/auth/login` → token JWT)
- sans mot de passe (joueurs du seed, données de test) → jeu direct (mode héritage)

Endpoints : `POST /api/auth/mot-de-passe` (définir/changer), `POST /api/auth/login` (token JWT HS256, 12 h). Les mots de passe sont hashés en PBKDF2-SHA256 + sel, stockés dans MongoDB.

### Quiz de calcul mental

10 questions, 10 secondes chacune, points selon la rapidité (jusqu'à 20 par question). Les sessions de quiz sont stockées dans **Redis** (clé `quiz:partie:<id>`, TTL 10 min) : elles survivent à un redémarrage du serveur et le mode multi-workers fonctionne. Le chrono est mesuré côté serveur.

### Menu console

```bash
python -m app.main
```

Le menu permet de :
- Créer un joueur (crée dans les 3 bases simultanément)
- Ajouter des amis
- Consulter le Top 10 global
- Consulter le classement entre amis
- Voir les amis et amis d'amis
- Gérer les inventaires
- Mettre à jour les scores

### Tests

```bash
# Tous les tests
pytest tests/ -v

# Tests d'un module spécifique
pytest tests/test_redis.py -v
pytest tests/test_mongo.py -v
pytest tests/test_neo4j.py -v
```

## Modules principaux

### Redis (`redis_service.py`) — Oussama

Utilise les **sorted sets** de Redis pour le classement :
- `set_score(joueur_id, score)` : définit le score d'un joueur
- `get_top_10()` : Top 10 global par score décroissant
- `get_scores_pour_ids(ids)` : scores triés pour une liste de joueurs (classement entre amis)
- `get_rang(joueur_id)` : rang d'un joueur dans le classement global
- `increment_score(joueur_id, points)` : ajoute des points à un joueur

### Intégration (`joueur_service.py`) — Oussama

Orchestre les trois bases :
- `creer_joueur()` : crée dans MongoDB + Redis + Neo4j
- `get_top_10_global()` : Redis (scores) + MongoDB (noms)
- `get_classement_amis()` : Neo4j (amis) + Redis (scores) + MongoDB (noms)
- `supprimer_joueur()` : supprime des 3 bases
