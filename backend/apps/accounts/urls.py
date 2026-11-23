"""E00-S03 routes. Explicit paths only: `accounts/<id>/<anything else>/` must fall through to
other apps (E01 serves `accounts/<id>/slot-template/` from apps/planning/urls.py)."""

from django.urls import path

from . import views

account_list = views.AccountViewSet.as_view({"get": "list", "post": "create"})
account_detail = views.AccountViewSet.as_view({"get": "retrieve", "patch": "partial_update"})

urlpatterns = [
    path("accounts/", account_list, name="account-list"),
    path("accounts/<int:pk>/", account_detail, name="account-detail"),
    path("accounts/<int:pk>/brand/", views.BrandView.as_view(), name="account-brand"),
    path("accounts/<int:pk>/brand/logo/", views.BrandLogoView.as_view(),
         name="account-brand-logo"),
    path("fonts/", views.FontListView.as_view(), name="font-list"),
]
