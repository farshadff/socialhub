from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("plans", views.PlanViewSet, basename="plan")
router.register("slots", views.SlotViewSet, basename="slot")

urlpatterns = [
    path("accounts/<int:account_id>/slot-template/", views.SlotTemplateView.as_view(),
         name="slot-template"),
    *router.urls,
]
