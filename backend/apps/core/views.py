from django.conf import settings
from django.db import connection
from redis import Redis
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from .providers import get_local_provider_summary


@api_view(["GET"])
@permission_classes([AllowAny])
def health_live(_request):
    return Response({"status": "ok"})


@api_view(["GET"])
@permission_classes([AllowAny])
def health_ready(_request):
    dependencies = {"database": "ok", "redis": "ok"}
    try:
        connection.ensure_connection()
    except Exception:
        dependencies["database"] = "unavailable"

    redis_client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
    try:
        redis_client.ping()
    except Exception:
        dependencies["redis"] = "unavailable"
    finally:
        redis_client.close()

    ready = all(value == "ok" for value in dependencies.values())
    return Response(
        {"status": "ready" if ready else "not_ready", "dependencies": dependencies},
        status=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def local_demo(_request):
    return Response(
        {
            "mode": "local_fixture",
            "source_mode": settings.SOCIALHUB_DEFAULT_SOURCE_MODE,
            "account_timezone": settings.SOCIALHUB_DEFAULT_ACCOUNT_TIME_ZONE,
            **get_local_provider_summary(),
        }
    )
