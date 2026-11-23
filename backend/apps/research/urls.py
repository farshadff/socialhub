from django.urls import path

from . import views

urlpatterns = [
    path("research/sources/", views.SourceListView.as_view(), name="research-source-list"),
    path("research/sources/<int:pk>/", views.SourceDetailView.as_view(),
         name="research-source-detail"),
    path("research/runs/", views.RunListView.as_view(), name="research-run-list"),
    path("research/runs/<int:pk>/", views.RunDetailView.as_view(), name="research-run-detail"),
    path("research/signals/", views.SignalListView.as_view(), name="research-signal-list"),
    path("research/topics/", views.TopicListView.as_view(), name="research-topic-list"),
    path("research/topics/<int:pk>/", views.TopicDetailView.as_view(),
         name="research-topic-detail"),
]
