"""Client Firebase minimal en REST (Identity Toolkit + Realtime Database),
pour ne dépendre que de `requests`. Cible le même projet Firebase que
l'appli Android Oracle : mêmes identifiants, même base de données.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests

from . import config

IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1"
TOKEN_URL = "https://securetoken.googleapis.com/v1/token"

TIMEOUT = 15


class FirebaseError(RuntimeError):
    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


def _raise_for_error(resp: requests.Response) -> None:
    if resp.ok:
        return
    code = ""
    message = f"Erreur HTTP {resp.status_code}"
    try:
        payload = resp.json()
        err = payload.get("error", {})
        code = err.get("message", "")
        message = code or message
    except ValueError:
        pass
    raise FirebaseError(_translate_error(code) or message, code)


def _translate_error(code: str) -> Optional[str]:
    mapping = {
        "EMAIL_NOT_FOUND": "Aucun compte avec cet e-mail.",
        "INVALID_PASSWORD": "Mot de passe incorrect.",
        "INVALID_LOGIN_CREDENTIALS": "Identifiants invalides.",
        "EMAIL_EXISTS": "Un compte existe déjà avec cet e-mail.",
        "WEAK_PASSWORD : Password should be at least 6 characters": "Mot de passe trop court (6 caractères minimum).",
        "INVALID_EMAIL": "Adresse e-mail invalide.",
        "USER_DISABLED": "Ce compte a été désactivé.",
    }
    for key, value in mapping.items():
        if code.startswith(key.split(" ")[0]):
            return value
    return None


@dataclass
class Session:
    id_token: str
    refresh_token: str
    local_id: str
    email: str
    expires_at: float  # epoch seconds

    def to_dict(self) -> dict[str, Any]:
        return {
            "id_token": self.id_token,
            "refresh_token": self.refresh_token,
            "local_id": self.local_id,
            "email": self.email,
            "expires_at": self.expires_at,
        }

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Session":
        return Session(
            id_token=d["id_token"],
            refresh_token=d["refresh_token"],
            local_id=d["local_id"],
            email=d.get("email", ""),
            expires_at=float(d.get("expires_at", 0)),
        )


class FirebaseAuth:
    def __init__(self, api_key: str = config.FIREBASE_API_KEY):
        self.api_key = api_key

    def sign_in(self, email: str, password: str) -> Session:
        return self._auth_call("accounts:signInWithPassword", email, password)

    def sign_up(self, email: str, password: str) -> Session:
        return self._auth_call("accounts:signUp", email, password)

    def _auth_call(self, endpoint: str, email: str, password: str) -> Session:
        resp = requests.post(
            f"{IDENTITY_BASE}/{endpoint}",
            params={"key": self.api_key},
            json={"email": email, "password": password, "returnSecureToken": True},
            timeout=TIMEOUT,
        )
        _raise_for_error(resp)
        data = resp.json()
        return Session(
            id_token=data["idToken"],
            refresh_token=data["refreshToken"],
            local_id=data["localId"],
            email=email,
            expires_at=time.time() + float(data.get("expiresIn", 3600)) - 60,
        )

    def refresh(self, session: Session) -> Session:
        resp = requests.post(
            TOKEN_URL,
            params={"key": self.api_key},
            data={"grant_type": "refresh_token", "refresh_token": session.refresh_token},
            timeout=TIMEOUT,
        )
        _raise_for_error(resp)
        data = resp.json()
        return Session(
            id_token=data["id_token"],
            refresh_token=data["refresh_token"],
            local_id=data["user_id"],
            email=session.email,
            expires_at=time.time() + float(data.get("expires_in", 3600)) - 60,
        )


class RealtimeDatabase:
    def __init__(
        self,
        database_url: str = config.FIREBASE_DATABASE_URL,
        sync_path: str = config.FIREBASE_SYNC_PATH,
    ):
        self.base_url = database_url.rstrip("/")
        self.sync_path = sync_path.strip("/")

    def _url(self) -> str:
        return f"{self.base_url}/{self.sync_path}.json"

    def get(self, id_token: str) -> Optional[dict[str, Any]]:
        resp = requests.get(self._url(), params={"auth": id_token}, timeout=TIMEOUT)
        _raise_for_error(resp)
        return resp.json()

    def put(self, id_token: str, value: dict[str, Any]) -> None:
        resp = requests.put(
            self._url(),
            params={"auth": id_token},
            data=json.dumps(value),
            timeout=TIMEOUT,
        )
        _raise_for_error(resp)
