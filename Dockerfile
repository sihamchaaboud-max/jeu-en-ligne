# API FastAPI du jeu en ligne (MongoDB + Redis + Neo4j)
FROM python:3.12-slim

WORKDIR /app

# Dépendances d'abord (cache Docker : couche inchangée si requirements.txt ne bouge pas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code de l'application
COPY . .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000"]
