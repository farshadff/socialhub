import uuid

from django.conf import settings
from django.db import connection
from django.db.models import F, Q
from redis import Redis
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from .models import JobRun
from .permissions import is_admin
from .serializers import JobListQuerySerializer, JobSerializer


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


class JobViewSet(ReadOnlyModelViewSet):
    """`GET /jobs/` and `GET /jobs/{id}/` (E00-S06 rules 19-21)."""

    serializer_class = JobSerializer

    def _visible(self):
        qs = JobRun.objects.select_related("created_by")
        user = self.request.user
        if is_admin(user):
            return qs
        # System jobs (no account) are visible only to admins and to the user who started them.
        return qs.filter(Q(account__isnull=False) | Q(created_by=user))

    def get_object(self):
        try:
            job_id = uuid.UUID(str(self.kwargs["pk"]))
        except ValueError:
            raise NotFound() from None
        try:
            return self._visible().get(pk=job_id)
        except JobRun.DoesNotExist:
            raise NotFound() from None

    def get_queryset(self):
        params = JobListQuerySerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        qs = self._visible()

        account = data.get("account")
        if account is None:
            if not is_admin(self.request.user):
                raise ValidationError(
                    {"account": [ErrorDetail("This field is required.", code="required")]})
        elif account == "none":
            qs = qs.filter(account__isnull=True)
        else:
            qs = qs.filter(account_id=account)

        if data.get("kind"):
            qs = qs.filter(kind__in=data["kind"])
        if data.get("kind_prefix"):
            qs = qs.filter(kind__startswith=data["kind_prefix"])
        if data.get("status"):
            qs = qs.filter(status__in=data["status"])
        if data.get("target_type"):
            qs = qs.filter(target_type=data["target_type"])
        if data.get("target_id"):
            qs = qs.filter(target_id=data["target_id"])
        if data.get("created_after"):
            qs = qs.filter(created_at__gte=data["created_after"])
        if data.get("created_before"):
            qs = qs.filter(created_at__lt=data["created_before"])

        ordering = data["ordering"]
        name = ordering.lstrip("-")
        expr = F(name).desc(nulls_last=True) if ordering.startswith("-") else F(name).asc(
            nulls_last=True)
        return qs.order_by(expr, "-id" if ordering.startswith("-") else "id")
