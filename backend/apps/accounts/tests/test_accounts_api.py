"""E00-S03-BE2: account endpoints."""

import pytest
from django.apps import apps as django_apps
from django.urls import resolve

from apps.accounts.models import AccountConnection, InstagramAccount

from .factories import make_account

pytestmark = pytest.mark.django_db

LIST = "/api/v1/accounts/"


def detail(account) -> str:
    return f"/api/v1/accounts/{account.pk}/"


def field_errors(response) -> set[tuple[str, str]]:
    return {(f["path"], f["code"]) for f in response.json()["error"]["fields"]}


def error_code(response) -> str:
    return response.json()["error"]["code"]


def set_connection(account, status, provider="fake"):
    AccountConnection.objects.filter(account=account).update(status=status, provider=provider)


# --- create -------------------------------------------------------------------------------


def test_admin_creates_account_with_normalised_handle(admin_api):
    response = admin_api.post(LIST, {"handle": "  @GreenHome.ir ", "display_name": "Green Home",
                                     "timezone": "Asia/Tehran", "content_language": "fa",
                                     "week_start_day": 5, "notes": ""}, format="json")
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["handle"] == "greenhome.ir"
    assert body["connection_status"] == "disconnected"
    assert body["connection_provider"] == "fake"
    assert body["brand_complete"] is False
    assert body["publishing_enabled"] is False
    assert set(body) == {"id", "handle", "display_name", "timezone", "content_language",
                         "week_start_day", "status", "publishing_enabled", "autopilot",
                         "posting_rules", "notes", "connection_status", "connection_provider",
                         "brand_complete", "created_at", "updated_at"}
    account = InstagramAccount.objects.get(pk=body["id"])
    assert account.brand.handle_display == "@greenhome.ir"
    assert account.connection.status == "disconnected"


def test_create_requires_only_handle_and_display_name(admin_api):
    response = admin_api.post(LIST, {"handle": "shop", "display_name": "Shop"}, format="json")
    assert response.status_code == 201
    assert response.json()["timezone"] == "Asia/Tehran"
    assert response.json()["week_start_day"] == 5

    response = admin_api.post(LIST, {}, format="json")
    assert response.status_code == 400
    assert field_errors(response) == {("handle", "required"), ("display_name", "required")}


def test_operator_cannot_create(operator_api):
    response = operator_api.post(LIST, {"handle": "shop", "display_name": "Shop"},
                                 format="json")
    assert response.status_code == 403
    assert error_code(response) == "permission_denied"
    assert not InstagramAccount.objects.exists()


def test_anonymous_gets_authentication_required(client):
    response = client.get(LIST)
    assert response.status_code == 403
    assert error_code(response) == "authentication_required"


@pytest.mark.parametrize("payload, expected", [
    ({"handle": "bad handle!"}, ("handle", "invalid")),
    ({"handle": "a" * 31}, ("handle", "invalid")),
    ({"handle": "@"}, ("handle", "invalid")),
    ({"timezone": "Mars/Olympus"}, ("timezone", "invalid")),
    ({"week_start_day": 7}, ("week_start_day", "max_value")),
    ({"week_start_day": -1}, ("week_start_day", "min_value")),
    ({"content_language": "de"}, ("content_language", "invalid_choice")),
    ({"display_name": ""}, ("display_name", "blank")),
    ({"display_name": "x" * 81}, ("display_name", "max_length")),
])
def test_create_validation(admin_api, payload, expected):
    data = {"handle": "shop", "display_name": "Shop", **payload}
    response = admin_api.post(LIST, data, format="json")
    assert response.status_code == 400
    assert error_code(response) == "validation_error"
    assert expected in field_errors(response)


@pytest.mark.parametrize("existing_status", ["active", "archived"])
def test_handle_unique_in_any_case_including_archived(admin_api, existing_status):
    make_account(handle="greenhome.ir", status=existing_status)
    response = admin_api.post(LIST, {"handle": "@GREENHOME.IR", "display_name": "Again"},
                              format="json")
    assert response.status_code == 400
    assert field_errors(response) == {("handle", "unique")}


# --- list and read ------------------------------------------------------------------------


def test_list_ordering_filters_and_search(operator_api):
    make_account(handle="zeta", display_name="Last")
    make_account(handle="alpha", display_name="Green Home")
    make_account(handle="mid", display_name="Middle", status="archived")

    body = operator_api.get(LIST).json()
    assert body["count"] == 3
    assert [r["handle"] for r in body["results"]] == ["alpha", "mid", "zeta"]

    active = operator_api.get(LIST, {"status": "active"}).json()
    assert [r["handle"] for r in active["results"]] == ["alpha", "zeta"]
    archived = operator_api.get(LIST, {"status": "archived"}).json()
    assert [r["handle"] for r in archived["results"]] == ["mid"]
    both = operator_api.get(LIST, {"status": "active,archived"}).json()
    assert both["count"] == 3

    assert [r["handle"] for r in operator_api.get(LIST, {"search": "GREEN"}).json()["results"]] \
        == ["alpha"]
    assert [r["handle"] for r in operator_api.get(LIST, {"search": "@ze"}).json()["results"]] \
        == ["zeta"]

    response = operator_api.get(LIST, {"status": "deleted"})
    assert response.status_code == 400
    assert field_errors(response) == {("status", "invalid_choice")}


def test_list_pagination(operator_api):
    for _ in range(3):
        make_account()
    body = operator_api.get(LIST, {"page_size": 2}).json()
    assert body["count"] == 3 and len(body["results"]) == 2 and body["next"]


def test_retrieve_and_unknown(operator_api):
    account = make_account(connected=True)
    body = operator_api.get(detail(account)).json()
    assert body["id"] == account.pk
    assert body["connection_status"] == "connected"
    response = operator_api.get("/api/v1/accounts/999999/")
    assert response.status_code == 404
    assert error_code(response) == "not_found"


@pytest.mark.parametrize("method", ["put", "delete"])
def test_no_put_or_delete(admin_api, method):
    account = make_account()
    response = getattr(admin_api, method)(detail(account), {}, format="json")
    assert response.status_code == 405
    assert InstagramAccount.objects.filter(pk=account.pk).exists()


# --- update: permission matrix ------------------------------------------------------------

OPERATOR_FIELDS = {
    "display_name": "New name",
    "timezone": "Europe/Berlin",
    "content_language": "en",
    "week_start_day": 0,
    "notes": "Some notes",
    "posting_rules": {"min_gap_minutes": 60},
}
ADMIN_FIELDS = {
    "handle": "renamed",
    "status": "archived",
    "publishing_enabled": False,
    "autopilot": {"brief": True},
}


@pytest.mark.parametrize("field", sorted(OPERATOR_FIELDS))
@pytest.mark.parametrize("role", ["admin", "operator"])
def test_both_roles_update_operator_fields(request, role, field):
    client = request.getfixturevalue(f"{role}_api")
    account = make_account()
    response = client.patch(detail(account), {field: OPERATOR_FIELDS[field]}, format="json")
    assert response.status_code == 200, response.json()


@pytest.mark.parametrize("field", sorted(ADMIN_FIELDS))
def test_admin_updates_admin_fields(admin_api, field):
    account = make_account()
    response = admin_api.patch(detail(account), {field: ADMIN_FIELDS[field]}, format="json")
    assert response.status_code == 200, response.json()


@pytest.mark.parametrize("field", sorted(ADMIN_FIELDS))
def test_operator_sending_admin_field_is_denied_and_nothing_saved(operator_api, field):
    account = make_account(display_name="Original")
    response = operator_api.patch(
        detail(account), {"display_name": "X", field: ADMIN_FIELDS[field]}, format="json")
    assert response.status_code == 403
    assert error_code(response) == "permission_denied"
    account.refresh_from_db()
    assert account.display_name == "Original"


def test_operator_publishing_true_denied(operator_api):
    """AC 4."""
    account = make_account(display_name="Original", connected=True)
    response = operator_api.patch(detail(account), {"display_name": "X",
                                                    "publishing_enabled": True}, format="json")
    assert response.status_code == 403
    account.refresh_from_db()
    assert account.display_name == "Original" and account.publishing_enabled is False


# --- update: JSON merge -------------------------------------------------------------------


def test_autopilot_and_posting_rules_merge(admin_api):
    account = make_account(autopilot={"selection": True, "brief": False, "script": True})
    response = admin_api.patch(detail(account), {"autopilot": {"brief": True},
                                                 "posting_rules": {"min_gap_minutes": 180}},
                               format="json")
    assert response.status_code == 200
    body = response.json()
    assert body["autopilot"] == {"selection": True, "brief": True, "script": True}
    assert body["posting_rules"] == {"min_gap_minutes": 180, "max_feed_per_day": 2,
                                     "max_stories_per_day": 5, "max_revisions": 2}


@pytest.mark.parametrize("payload, expected", [
    ({"posting_rules": {"min_gap_minutes": 5}}, ("posting_rules.min_gap_minutes", "min_value")),
    ({"posting_rules": {"min_gap_minutes": 1441}},
     ("posting_rules.min_gap_minutes", "max_value")),
    ({"posting_rules": {"max_feed_per_day": 0}}, ("posting_rules.max_feed_per_day", "min_value")),
    ({"posting_rules": {"max_feed_per_day": 11}},
     ("posting_rules.max_feed_per_day", "max_value")),
    ({"posting_rules": {"max_stories_per_day": 21}},
     ("posting_rules.max_stories_per_day", "max_value")),
    ({"posting_rules": {"max_revisions": 6}}, ("posting_rules.max_revisions", "max_value")),
    ({"posting_rules": {"max_revisions": "2"}}, ("posting_rules.max_revisions", "invalid")),
    ({"posting_rules": {"per_hour": 1}}, ("posting_rules.per_hour", "invalid")),
    ({"posting_rules": [1, 2]}, ("posting_rules", "invalid")),
    ({"autopilot": {"publish": True}}, ("autopilot.publish", "invalid")),
    ({"autopilot": {"brief": "yes"}}, ("autopilot.brief", "invalid")),
    ({"autopilot": True}, ("autopilot", "invalid")),
    ({"status": "deleted"}, ("status", "invalid_choice")),
])
def test_update_validation(admin_api, payload, expected):
    account = make_account()
    response = admin_api.patch(detail(account), payload, format="json")
    assert response.status_code == 400
    assert error_code(response) == "validation_error"
    assert expected in field_errors(response)
    account.refresh_from_db()
    assert account.posting_rules["min_gap_minutes"] == 120


# --- update: transitions ------------------------------------------------------------------


def test_archive_forces_publishing_off_and_restore_keeps_it_off(admin_api):
    """AC 6."""
    account = make_account(connected=True, publishing_enabled=True)
    response = admin_api.patch(detail(account), {"status": "archived"}, format="json")
    assert response.status_code == 200
    assert response.json()["status"] == "archived"
    assert response.json()["publishing_enabled"] is False
    assert admin_api.get(LIST, {"status": "active"}).json()["count"] == 0

    response = admin_api.patch(detail(account), {"status": "active"}, format="json")
    assert response.json()["status"] == "active"
    assert response.json()["publishing_enabled"] is False


def test_publishing_on_for_archived_account_is_refused(admin_api):
    account = make_account(connected=True, status="archived")
    response = admin_api.patch(detail(account), {"publishing_enabled": True}, format="json")
    assert response.status_code == 409
    assert error_code(response) == "invalid_transition"
    assert response.json()["error"]["details"] == {"status": "archived",
                                                   "reason": "account_archived"}


@pytest.mark.parametrize("provider, status, allowed", [
    ("graph_api", "disconnected", False),
    ("fake", "disconnected", False),
    ("fake", "needs_attention", False),
    ("fake", "connected", True),
    ("fake", "expiring", True),
    ("manual", "connected", True),
])
def test_publishing_requires_connected_or_expiring(admin_api, provider, status, allowed):
    """AC 5 and rule 11."""
    account = make_account()
    set_connection(account, status, provider)
    response = admin_api.patch(detail(account), {"publishing_enabled": True}, format="json")
    account.refresh_from_db()
    if allowed:
        assert response.status_code == 200
        assert account.publishing_enabled is True
    else:
        assert response.status_code == 409
        assert error_code(response) == "instagram_not_connected"
        assert account.publishing_enabled is False


def test_turning_publishing_off_is_always_allowed(admin_api):
    account = make_account(publishing_enabled=True)  # disconnected
    response = admin_api.patch(detail(account), {"publishing_enabled": False}, format="json")
    assert response.status_code == 200
    assert response.json()["publishing_enabled"] is False


@pytest.mark.parametrize("status", ["connected", "expiring", "needs_attention"])
def test_handle_change_while_not_disconnected(admin_api, status):
    """AC 14."""
    account = make_account(handle="original")
    set_connection(account, status)
    response = admin_api.patch(detail(account), {"handle": "renamed"}, format="json")
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_transition"
    assert error["details"] == {"status": status, "reason": "connection_not_disconnected"}
    account.refresh_from_db()
    assert account.handle == "original"


def test_same_handle_while_connected_is_not_a_change(admin_api):
    account = make_account(handle="original", connected=True)
    response = admin_api.patch(detail(account), {"handle": "@Original"}, format="json")
    assert response.status_code == 200


def test_handle_change_while_disconnected(admin_api):
    account = make_account(handle="original")
    make_account(handle="taken", status="archived")
    response = admin_api.patch(detail(account), {"handle": "@Taken"}, format="json")
    assert response.status_code == 400
    assert field_errors(response) == {("handle", "unique")}

    response = admin_api.patch(detail(account), {"handle": "@Renamed"}, format="json")
    assert response.status_code == 200
    assert response.json()["handle"] == "renamed"


# --- routing ------------------------------------------------------------------------------


def test_slot_template_url_is_not_shadowed():
    if not django_apps.is_installed("apps.planning"):
        pytest.skip("apps.planning is not installed")
    match = resolve("/api/v1/accounts/1/slot-template/")
    assert match.func.__module__.startswith("apps.planning")
