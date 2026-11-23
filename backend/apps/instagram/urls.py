"""E00-S04 routes: the account's connection and the public OAuth callback."""

from django.urls import path

from . import views

urlpatterns = [
    path("accounts/<int:pk>/connection/", views.ConnectionView.as_view(),
         name="account-connection"),
    path("accounts/<int:pk>/connection/connect/", views.ConnectView.as_view(),
         name="account-connection-connect"),
    path("accounts/<int:pk>/connection/verify/", views.VerifyView.as_view(),
         name="account-connection-verify"),
    path("accounts/<int:pk>/connection/refresh-token/", views.RefreshTokenView.as_view(),
         name="account-connection-refresh-token"),
    path("instagram/oauth/callback/", views.oauth_callback, name="instagram-oauth-callback"),
]
