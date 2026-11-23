from django.urls import path

from . import views

job_list = views.JobViewSet.as_view({"get": "list"})
job_detail = views.JobViewSet.as_view({"get": "retrieve"})

urlpatterns = [
    path("health/live/", views.health_live, name="health-live"),
    path("health/ready/", views.health_ready, name="health-ready"),
    path("jobs/", job_list, name="job-list"),
    path("jobs/<str:pk>/", job_detail, name="job-detail"),
]
