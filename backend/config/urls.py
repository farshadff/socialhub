from importlib.util import find_spec

from django.apps import apps as django_apps
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def api_root(request):
    return Response({"service": "socialhub-api", "version": "v1"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", api_root, name="api-root"),
    path("api/v1/", include("apps.core.urls")),
    path("api/v1/auth/", include("apps.accounts.urls_auth")),
    path("api/v1/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.instagram.urls")),  # E00-S04 connection and OAuth callback
    path("api/v1/", include("apps.ai.urls")),
]

# Workflow apps owned by other epics: mounted when their URL module exists.
def _mountable(app: str) -> bool:
    if not django_apps.is_installed(app):
        return False
    try:
        return find_spec(f"{app}.urls") is not None
    except ModuleNotFoundError:
        return False


for _app in ("apps.planning", "apps.research"):
    if _mountable(_app):
        urlpatterns.append(path("api/v1/", include(f"{_app}.urls")))

# --- E03-E06 --- content items, briefs, scripts, assets, production --------------------------
for _app in ("apps.content", "apps.production"):
    if _mountable(_app):
        urlpatterns.append(path("api/v1/", include(f"{_app}.urls")))

# Local media is served by Django only in development (E00-S06 rule 26).
if settings.SOCIALHUB_MEDIA_BACKEND == "local":
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
