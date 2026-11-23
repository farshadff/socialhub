from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("sources", views.ResearchSourceViewSet, basename="research-source")
router.register("runs", views.ResearchRunViewSet, basename="research-run")
router.register("signals", views.TrendSignalViewSet, basename="research-signal")
router.register("topics", views.TrendTopicViewSet, basename="research-topic")

urlpatterns = router.urls
