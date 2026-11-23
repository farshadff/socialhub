"""Shared pytest fixtures. `admin_user` and `operator_user` are reused by later stories."""

import pytest
from rest_framework.test import APIClient

TEST_PASSWORD = "correct horse battery staple"


@pytest.fixture
def admin_user(db, django_user_model):
    """The `admin` superuser (role `admin`)."""
    return django_user_model.objects.create_user(
        "admin", email="", password=TEST_PASSWORD, is_superuser=True, is_staff=True)


@pytest.fixture
def operator_user(db, django_user_model):
    """The `operator` user (role `operator`)."""
    return django_user_model.objects.create_user(
        "operator", email="op@example.com", password=TEST_PASSWORD,
        first_name="Sara", last_name="Moradi")


@pytest.fixture(autouse=True)
def _reset_fake_instagram():
    """E00-S04: the fake Instagram keeps remote accounts in process memory; IDs are reused
    between tests, so every test starts with empty remote accounts."""
    from apps.instagram.providers.fake import FakeProvider

    FakeProvider.reset()
    yield
    FakeProvider.reset()


@pytest.fixture
def api_client():
    """An anonymous client that enforces CSRF like a browser."""
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def admin_api(admin_user):
    client = APIClient()
    client.force_login(admin_user)
    return client


@pytest.fixture
def operator_api(operator_user):
    client = APIClient()
    client.force_login(operator_user)
    return client
