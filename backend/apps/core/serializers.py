from rest_framework import serializers


class UserRefField(serializers.Field):
    """Nested user reference ``{"id", "name"}``; name is the full name, else the username."""

    def __init__(self, **kwargs):
        kwargs.setdefault("read_only", True)
        super().__init__(**kwargs)

    def to_representation(self, user):
        if user is None:
            return None
        return {"id": user.pk, "name": user.get_full_name().strip() or user.get_username()}
