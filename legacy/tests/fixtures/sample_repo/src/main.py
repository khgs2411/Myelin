"""Sample app entry point."""

from src import auth, db


def main() -> None:
    session = auth.login("alice", "tok")
    db.put("hello", {"user": auth.whoami(session)})
    print(db.get("hello"))


if __name__ == "__main__":
    main()
