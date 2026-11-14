"""
Service Redis - Personne 2 (Oussama)

Responsabilités :
  - Stocker les scores des joueurs (sorted set)
  - Implémenter le Top 10 global
  - Fournir les scores pour le classement entre amis

Utilisation principale : les sorted sets de Redis.
La clé "classement_global" est un sorted set où :
  - member = identifiant du joueur
  - score  = score du joueur
Redis trie automatiquement les membres par score croissant.
"""

import json

import redis
from app.config import QUIZ_PARTIE_TTL, REDIS_URL

# Clé du sorted set global contenant tous les scores
CLE_CLASSEMENT_GLOBAL = "classement_global"

# Sessions de quiz : quiz:partie:<partie_id> -> état JSON de la partie
PREFIXE_PARTIE = "quiz:partie:"

# Canal pub/sub notifiant chaque changement de score (WebSocket Top 10)
CANAL_SCORES = "canal:scores"


class RedisService:
    """Couche d'accès à Redis pour la gestion des scores et classements."""

    def __init__(self):
        """Initialise la connexion Redis."""
        self.client = redis.from_url(REDIS_URL, decode_responses=True)

    # ==================================================
    # Gestion des scores
    # ==================================================

    def set_score(self, joueur_id: str, score: int) -> None:
        """
        Définit le score d'un joueur.
        Si le joueur existe déjà, son score est mis à jour.

        Args:
            joueur_id: identifiant unique du joueur
            score:     score à attribuer
        """
        self.client.zadd(CLE_CLASSEMENT_GLOBAL, {joueur_id: score})

    def get_score(self, joueur_id: str) -> int | None:
        """
        Récupère le score d'un joueur.

        Returns:
            Le score (int) ou None si le joueur n'est pas classé.
        """
        score = self.client.zscore(CLE_CLASSEMENT_GLOBAL, joueur_id)
        return int(score) if score is not None else None

    def increment_score(self, joueur_id: str, points: int) -> int:
        """
        Augmente (ou diminue) le score d'un joueur d'un certain nombre de points.
        Crée le joueur avec un score de départ s'il n'existe pas.

        Args:
            joueur_id: identifiant du joueur
            points:    points à ajouter (peut être négatif)

        Returns:
            Le nouveau score du joueur.
        """
        return self.client.zincrby(CLE_CLASSEMENT_GLOBAL, points, joueur_id)

    def delete_score(self, joueur_id: str) -> None:
        """Supprime un joueur du classement global."""
        self.client.zrem(CLE_CLASSEMENT_GLOBAL, joueur_id)

    # ==================================================
    # Top 10 global
    # ==================================================

    def get_top_10(self) -> list[tuple[str, int]]:
        """
        Récupère le Top 10 global des joueurs par score décroissant.

        Returns:
            Liste de tuples (joueur_id, score), du meilleur au 10e.
        """
        # zrevrange renvoie les scores les plus élevés en premier
        resultats = self.client.zrevrange(
            CLE_CLASSEMENT_GLOBAL, 0, 9, withscores=True
        )
        return [(joueur_id, int(score)) for joueur_id, score in resultats]

    def get_rang(self, joueur_id: str) -> int | None:
        """
        Récupère le rang d'un joueur dans le classement global.
        Le rang 1 correspond au meilleur joueur.

        Returns:
            Le rang (1-indexé) ou None si le joueur n'est pas classé.
        """
        rang = self.client.zrevrank(CLE_CLASSEMENT_GLOBAL, joueur_id)
        return rang + 1 if rang is not None else None

    def get_nombre_joueurs(self) -> int:
        """Retourne le nombre total de joueurs classés."""
        return self.client.zcard(CLE_CLASSEMENT_GLOBAL)

    # ==================================================
    # Classement entre amis
    # ==================================================

    def get_scores_pour_ids(self, joueur_ids: list[str]) -> list[tuple[str, int]]:
        """
        Récupère et trie les scores d'une liste de joueurs.
        Utilisé par joueur_service pour le classement entre amis.

        Args:
            joueur_ids: liste des identifiants à classer

        Returns:
            Liste de tuples (joueur_id, score) triée par score décroissant.
        """
        if not joueur_ids:
            return []

        # Utilise ZMSCORE pour récupérer tous les scores en une seule commande
        scores = self.client.zmscore(CLE_CLASSEMENT_GLOBAL, joueur_ids)

        # Construit la liste des (id, score) en ignorant les joueurs sans score
        classement = []
        for joueur_id, score in zip(joueur_ids, scores):
            if score is not None:
                classement.append((joueur_id, int(score)))

        # Tri par score décroissant
        classement.sort(key=lambda x: x[1], reverse=True)
        return classement

    # ==================================================
    # Sessions de quiz (état stocké dans Redis, pas en mémoire)
    # ==================================================

    def sauver_partie(self, partie_id: str, etat: dict, ttl: int = None) -> None:
        """Stocke l'état d'une partie de quiz avec une durée de vie.

        Args:
            partie_id: identifiant de la partie
            etat:      Partie.to_dict()
            ttl:       expiration en secondes (défaut : QUIZ_PARTIE_TTL)
        """
        self.client.set(
            PREFIXE_PARTIE + partie_id,
            json.dumps(etat),
            ex=ttl or QUIZ_PARTIE_TTL,
        )

    def charger_partie(self, partie_id: str) -> dict | None:
        """Lit l'état d'une partie, ou None si inexistante ou expirée."""
        brut = self.client.get(PREFIXE_PARTIE + partie_id)
        return json.loads(brut) if brut else None

    def supprimer_partie(self, partie_id: str) -> None:
        """Supprime la session d'une partie terminée ou abandonnée."""
        self.client.delete(PREFIXE_PARTIE + partie_id)

    # ==================================================
    # Diffusion des changements de score (WebSocket Top 10)
    # ==================================================

    def publier_maj_scores(self) -> None:
        """Publie sur le canal scores : les clients WebSocket rechargeront le Top 10."""
        self.client.publish(CANAL_SCORES, "maj")

    def souscrire_scores(self):
        """Abonnement au canal scores (utilisé par le diffuseur WebSocket)."""
        pubsub = self.client.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(CANAL_SCORES)
        return pubsub

    # ==================================================
    # Nettoyage
    # ==================================================

    def clear(self) -> None:
        """Efface entièrement le classement global (utile pour les tests)."""
        self.client.delete(CLE_CLASSEMENT_GLOBAL)
