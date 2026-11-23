from django.urls import path

from . import views

run_list = views.AIRunViewSet.as_view({"get": "list"})
run_detail = views.AIRunViewSet.as_view({"get": "retrieve"})

urlpatterns = [
    path("system/status/", views.system_status, name="system-status"),
    path("system/ai-test/", views.ai_test, name="system-ai-test"),
    path("ai/runs/", run_list, name="ai-run-list"),
    path("ai/runs/<str:pk>/", run_detail, name="ai-run-detail"),
]
