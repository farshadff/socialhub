"""Role rules (E00-S01). The role is derived from `is_superuser`, never stored."""

from rest_framework.permissions import SAFE_METHODS, BasePermission

ADMIN = "admin"
OPERATOR = "operator"


def user_role(user) -> str:
    return ADMIN if user.is_superuser else OPERATOR


def is_admin(user) -> bool:
    return bool(user and user.is_authenticated and user.is_superuser)


class IsAdmin(BasePermission):
    """Admin-only endpoints. A signed-in operator gets `403 permission_denied`."""

    def has_permission(self, request, view):
        return is_admin(request.user)


class IsAdminOrReadOnly(BasePermission):
    """Any signed-in user may read; only admins may change."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or user.is_superuser
