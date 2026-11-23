"""Role definitions (E04-S02 rule 1). Code, not a table."""

from __future__ import annotations

from dataclasses import dataclass

from apps.planning.models import Role


@dataclass(frozen=True)
class RoleDefinition:
    key: str
    label: str
    purpose: str
    guidance: str
    examples: tuple[str, ...]
    default_metric: str
    default_metric_story: str

    def as_dict(self) -> dict:
        return {
            "key": self.key, "label": self.label, "purpose": self.purpose,
            "guidance": self.guidance, "examples": list(self.examples),
            "default_metric": self.default_metric,
            "default_metric_story": self.default_metric_story,
        }


ROLES: tuple[RoleDefinition, ...] = (
    RoleDefinition(
        "attract", "Attract", "Reach people who do not follow the account yet",
        "Lead with a broad, curiosity-driven hook. Easy to understand without context. "
        "Built to be shared or recommended.",
        ("A surprising fact about the topic", "A trend applied to the brand's field"),
        "reach", "reach"),
    RoleDefinition(
        "educate", "Educate", "Teach something useful enough to save",
        "One clear lesson, steps or a checklist. Concrete and practical. Ends with something "
        "worth coming back to.",
        ("Three steps to …", "A mistake to avoid when …"),
        "saves", "saves"),
    RoleDefinition(
        "build_trust", "Build trust", "Show proof, results or the people behind the brand",
        "Use real numbers, customer results or behind-the-scenes moments. Honest tone, no "
        "hard sell.",
        ("How we reduced delivery time", "A day with the support team"),
        "shares", "shares"),
    RoleDefinition(
        "convert", "Convert", "Move people to a concrete action",
        "One offer or action, the reason to act now, and a clear call to action.",
        ("The winter collection is live", "Book a free consultation this week"),
        "shares", "shares"),
    RoleDefinition(
        "engage", "Engage", "Start a conversation with the audience",
        "Ask a question or invite an opinion the audience can answer in a few words.",
        ("Which one would you choose?", "Tell us your best tip for …"),
        "comments", "replies"),
)

ROLE_KEYS = tuple(r.key for r in ROLES)
assert set(ROLE_KEYS) == set(Role.values), "roles.py must cover every Role value"


def get_role(key: str) -> RoleDefinition:
    for role in ROLES:
        if role.key == key:
            return role
    raise KeyError(key)


def label(key: str | None) -> str:
    if not key:
        return "Not set"
    return get_role(key).label


def default_metric(role: str, format: str) -> str:
    definition = get_role(role)
    return definition.default_metric_story if format == "story" else definition.default_metric


def roles_payload() -> list[dict]:
    return [role.as_dict() for role in ROLES]
