from django.urls import path

from . import job_views, views

urlpatterns = [
    path("health/live/", views.health_live, name="health-live"),
    path("health/ready/", views.health_ready, name="health-ready"),
    path("demo/", views.local_demo, name="local-demo"),
    path("jobs/", job_views.JobListView.as_view(), name="job-list"),
    path("jobs/<uuid:job_id>/", job_views.JobDetailView.as_view(), name="job-detail"),
]
