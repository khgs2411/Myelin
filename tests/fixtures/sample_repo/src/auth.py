"""Session authentication helpers."""

import time

SESSIONS = {}


def login(username: str, token: str) -> str:
    """Create a session and return its id."""
    session_id = f"{username}-{int(time.time())}"
    SESSIONS[session_id] = {"username": username, "token": token}
    return session_id


def logout(session_id: str) -> bool:
    """Invalidate a session. Returns True if it existed."""
    return SESSIONS.pop(session_id, None) is not None


def whoami(session_id: str) -> str | None:
    """Return the username for a session, or None."""
    entry = SESSIONS.get(session_id)
    return entry["username"] if entry else None
