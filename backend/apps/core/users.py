"""User display helpers shared by every app (docs/API.md, "Shapes")."""


def full_name(user) -> str:
    """`first_name` and `last_name` joined; falls back to the username."""
    name = f"{user.first_name} {user.last_name}".strip()
    return name or user.get_username()


def user_ref(user) -> dict | None:
    """The nested reference `{"id", "name"}` used everywhere outside `/auth/*`."""
    if user is None:
        return None
    return {"id": user.pk, "name": full_name(user)}
