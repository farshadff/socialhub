from django.urls import path

from . import views, views_assets

urlpatterns = [
    path("formats/", views.FormatsView.as_view(), name="formats"),
    path("content-items/", views.ContentItemListView.as_view(), name="content-item-list"),
    path("content-items/<int:pk>/", views.ContentItemDetailView.as_view(),
         name="content-item-detail"),
    path("content-items/<int:pk>/cancel/", views.ContentItemCancelView.as_view(),
         name="content-item-cancel"),
    path("content-items/<int:pk>/events/", views.ContentItemEventsView.as_view(),
         name="content-item-events"),
    path("content-items/<int:pk>/brief/", views.BriefView.as_view(), name="brief"),
    path("content-items/<int:pk>/brief/generate/", views.BriefGenerateView.as_view(),
         name="brief-generate"),
    path("content-items/<int:pk>/brief/versions/", views.BriefVersionsView.as_view(),
         name="brief-versions"),
    path("content-items/<int:pk>/brief/approve/", views.BriefApproveView.as_view(),
         name="brief-approve"),
    path("plans/<int:pk>/briefs/generate/", views.PlanBriefsGenerateView.as_view(),
         name="plan-briefs-generate"),
    path("content-items/<int:pk>/script/", views.ScriptView.as_view(), name="script"),
    path("content-items/<int:pk>/script/generate/", views.ScriptGenerateView.as_view(),
         name="script-generate"),
    path("content-items/<int:pk>/script/versions/", views.ScriptVersionsView.as_view(),
         name="script-versions"),
    path("content-items/<int:pk>/script/versions/<int:version>/",
         views.ScriptVersionDetailView.as_view(), name="script-version-detail"),
    path("content-items/<int:pk>/script/approve/", views.ScriptApproveView.as_view(),
         name="script-approve"),
    path("assets/", views_assets.AssetListView.as_view(), name="asset-list"),
    path("assets/<int:pk>/", views_assets.AssetDetailView.as_view(), name="asset-detail"),
]
