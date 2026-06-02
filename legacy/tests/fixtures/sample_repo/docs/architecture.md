# Architecture

Two layers:

- `src/auth.py` — session layer, owns `SESSIONS` dict
- `src/db.py` — storage layer, owns `_STORE` dict

`src/main.py` wires them via simple imports.
