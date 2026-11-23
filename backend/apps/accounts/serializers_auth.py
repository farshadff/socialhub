"""Request and response shapes of the `/auth/*` endpoints (E00-S01)."""

from rest_framework import serializers

from apps.core.permissions import user_role
from apps.core.users import full_name


class UserSerializer(serializers.Serializer):
    """The full user object; returned only by `/auth/*` (docs/API.md, "Shapes")."""

    def to_representation(self, user) -> dict:
        return {
            "id": user.pk,
            "username": user.get_username(),
            "full_name": full_name(user),
            "email": user.email or "",
            "role": user_role(user),
        }


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, trim_whitespace=True)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
