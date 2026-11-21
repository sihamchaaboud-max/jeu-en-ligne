"""
Configuration centrale du projet.

Lit les variables d'environnement depuis le fichier .env
pour les connexions aux trois bases de données :
  - MongoDB  (Siham  : profils + inventaires)
  - Redis    (Oussama: scores + classements)
  - Neo4j    (Salma  : amis + amis d'amis)
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --------------------------------------------------
# MongoDB
# --------------------------------------------------
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "jeu_en_ligne")

# --------------------------------------------------
# Redis
# --------------------------------------------------
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# --------------------------------------------------
# Neo4j
# --------------------------------------------------
NEO4J_URL = os.getenv("NEO4J_URL", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password123")

# --------------------------------------------------
# Auth (JWT)
# --------------------------------------------------
# Fail-fast : on refuse de démarrer avec un secret absent ou par défaut.
# Générer une clé :  openssl rand -hex 32
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
_MAUVAIS_SECRET = ("", "CHANGEZ_MOI_AVEC_UNE_CLE_ALEATOIRE_LONGUE")
if JWT_SECRET in _MAUVAIS_SECRET or JWT_SECRET.startswith("secret-de-dev"):
    raise RuntimeError(
        "JWT_SECRET manquant ou non sécurisé dans .env.\n"
        "Générez une clé avec :  openssl rand -hex 32"
    )
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))   # 12 h

# --------------------------------------------------
# Administration
# --------------------------------------------------
# Clé partagée pour les opérations d'administration sensibles
# (ex. définir le mot de passe d'un joueur). Vide = fonction désactivée.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

# --------------------------------------------------
# Quiz
# --------------------------------------------------
QUIZ_PARTIE_TTL = int(os.getenv("QUIZ_PARTIE_TTL", "600"))         # secondes
