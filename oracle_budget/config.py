"""Configuration Firebase et emplacements de stockage local.

Les valeurs par défaut ci-dessous proviennent du projet Firebase de l'appli
Android "Oracle" (com.oracle2015.budget) : c'est la même base de données
que l'appli mobile utilise, donc ce client Linux lit/écrit les mêmes
données. Elles peuvent être surchargées par variables d'environnement si
besoin (ex: pour pointer vers un autre projet Firebase).
"""
from __future__ import annotations

import os
from pathlib import Path

FIREBASE_API_KEY = os.environ.get(
    "ORACLE_FIREBASE_API_KEY", "AIzaSyCxr0slvZKVOwApGfZRR_TJiefRxBpQNRY"
)
FIREBASE_PROJECT_ID = os.environ.get("ORACLE_FIREBASE_PROJECT_ID", "oracle-2015")
FIREBASE_DATABASE_URL = os.environ.get(
    "ORACLE_FIREBASE_DATABASE_URL",
    "https://oracle-2015-default-rtdb.europe-west1.firebasedatabase.app",
)
# Chemin de synchronisation dans la Realtime Database (identique à l'appli Android).
FIREBASE_SYNC_PATH = os.environ.get("ORACLE_FIREBASE_SYNC_PATH", "oracle-data")

APP_NAME = "oracle-budget"

CONFIG_DIR = Path(
    os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
) / APP_NAME
DATA_DIR = Path(
    os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
) / APP_NAME

LOCAL_DATA_FILE = DATA_DIR / "oracle-data-v1.json"
SESSION_FILE = CONFIG_DIR / "session.json"


def ensure_dirs() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
