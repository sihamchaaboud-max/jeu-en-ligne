import os
from dotenv import load_dotenv

load_dotenv()  # lit le fichier .env

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")