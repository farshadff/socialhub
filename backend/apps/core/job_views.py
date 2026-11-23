"""Job endpoints (E00-S06 rules 19–22): ``GET /jobs/`` and ``GET /jobs/{id}/``."""

from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework import generics
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from .exceptions import field_error
from .jobs import serialize_job
from .models import JobRun

_ORDERING = {"created_at", "-created_at", "finished_at", "-finished_at"}


def _visible_jobs(user):
    queryset = JobRun.objects.select_related("created_by")
    if user.is_superuser:
        return queryset
    # System jobs (no account) are visible only to admins and to the user who started them.
    return queryset.filter(Q(account__isnull=False) | Q(created_by=user))


def _csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


class JobListView(generics.GenericAPIView):
    def get(self, request):
        params = request.query_params
        queryset = _visible_jobs(request.user)
        account = params.get("account")
        if account is None:
            if not request.user.is_superuser:
                raise field_error("account", "required")
        elif account == "none":
            queryset = queryset.filter(account__isnull=True)
        elif account.isdigit():
            queryset = queryset.filter(account_id=int(account))
        else:
            raise field_error("account", "invalid")
        if params.get("kind"):
            queryset = queryset.filter(kind__in=_csv(params["kind"]))
        if params.get("kind_prefix"):
            queryset = queryset.filter(kind__startswith=params["kind_prefix"])
        if params.get("status"):
            queryset = queryset.filter(status__in=_csv(params["status"]))
        if params.get("target_type"):
            queryset = queryset.filter(target_type=params["target_type"])
        if params.get("target_id"):
            queryset = queryset.filter(target_id=params["target_id"])
        for name, lookup in (("created_after", "created_at__gte"), ("created_before", "created_at__lt")):
            if params.get(name):
                moment = parse_datetime(params[name])
                if moment is None:
                    raise field_error(name, "invalid")
                queryset = queryset.filter(**{lookup: moment})
        ordering = params.get("ordering", "-created_at")
        if ordering not in _ORDERING:
            raise field_error("ordering", "invalid_choice")
        queryset = queryset.order_by(ordering, "-created_at")
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response([serialize_job(job) for job in page])


class JobDetailView(generics.GenericAPIView):
    def get(self, request, job_id):
        job = _visible_jobs(request.user).filter(pk=job_id).first()
        if job is None:
            raise NotFound()
        return Response(serialize_job(job))
