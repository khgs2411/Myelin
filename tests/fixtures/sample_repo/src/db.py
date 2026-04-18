"""Minimal in-memory DB layer."""

_STORE: dict[str, dict] = {}


def put(key: str, value: dict) -> None:
    _STORE[key] = value


def get(key: str) -> dict | None:
    return _STORE.get(key)


def delete(key: str) -> bool:
    return _STORE.pop(key, None) is not None
