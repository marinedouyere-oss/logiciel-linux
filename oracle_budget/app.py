from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from .firebase_client import FirebaseError
from .repository import OracleRepository
from .ui.main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("Oracle Budget")

    repo = OracleRepository()
    try:
        if repo.try_resume_session():
            repo.pull_remote()
    except FirebaseError:
        pass

    window = MainWindow(repo)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
