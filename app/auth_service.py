"""
Authentification : mots de passe + tokens JWT.

Mots de passe :
  - jamais stockés en clair : hash PBKDF2-SHA256 (100 000 itérations) + sel aléatoire
  - le couple {hash, sel, algo} est rangé dans le profil MongoDB du joueur

Tokens :
  - JWT signé (HS256) avec JWT_SECRET du .env
  - charge utile : sub = joueur_id, iat, exp
  - le token est envoyé par le client dans l'en-tête « Authorization: Bearer <token> »
"""

import hashlib
import secrets
import time

import jwt

from app.config import JWT_EXPIRE_MINUTES, JWT_SECRET

_ITERATIONS = 100_000


# ─────────────────────────────────────────────
# Mots de passe
# ─────────────────────────────────────────────
def hacher_mot_de_passe(mot_de_passe: str) -> dict:
    """Hash un mot de passe avec un sel aléatoire.

    Returns:
        {"hash": hex, "sel": hex, "algo": "pbkdf2_sha256_100000"}
    """
    sel = secrets.token_hex(16)
    empreinte = hashlib.pbkdf2_hmac(
        "sha256", mot_de_passe.encode(), sel.encode(), _ITERATIONS
    ).hex()
    return {"hash": empreinte, "sel": sel, "algo": f"pbkdf2_sha256_{_ITERATIONS}"}


def verifier_mot_de_passe(mot_de_passe: str, stocke: dict) -> bool:
    """Re-hash avec le sel stocké et compare en temps constant."""
    empreinte = hashlib.pbkdf2_hmac(
        "sha256", mot_de_passe.encode(), stocke["sel"].encode(), _ITERATIONS
    ).hex()
    return secrets.compare_digest(empreinte, stocke["hash"])


# ─────────────────────────────────────────────
# Tokens JWT
# ─────────────────────────────────────────────
def creer_token(joueur_id: str) -> str:
    """Crée un token signé valant JWT_EXPIRE_MINUTES heures."""
    now = int(time.time())
    return jwt.encode(
        {"sub": joueur_id, "iat": now, "exp": now + JWT_EXPIRE_MINUTES * 60},
        JWT_SECRET,
        algorithm="HS256",
    )


def lire_token(token: str) -> str | None:
    """Vérifie la signature et l'expiration. Retourne le joueur_id, ou None."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
