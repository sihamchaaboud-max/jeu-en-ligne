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
JWT_SECRET = os.getenv(
    "JWT_SECRET",
    "secret-de-dev-a-changer-absolument-en-production-avec-une-longue-cle-aleatoire",
)
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))   # 12 h

# --------------------------------------------------
# Quiz
# --------------------------------------------------
QUIZ_PARTIE_TTL = int(os.getenv("QUIZ_PARTIE_TTL", "600"))         # secondes
