"""Which assets a version uses, and the rights a produced asset inherits (E06-S01 rules 9, 12a)."""

from __future__ import annotations

from apps.content.models import Asset, ContentVersion
from apps.content.services.assets import effective_rights, worst_rights


def _direct_ids(version: ContentVersion) -> list[int]:
    ids = [version.final_asset_id, version.cover_asset_id, version.music_asset_id]
    for frame in version.frames or []:
        ids += [frame.get("asset_id"), frame.get("background_asset_id")]
    for clip in version.clips or []:
        ids.append(clip.get("asset_id"))
    return [i for i in ids if i]


def expand(asset_ids) -> list[Asset]:
    """The given assets plus, recursively, their `meta.inputs`, without duplicates."""
    seen: dict[int, Asset] = {}
    queue = [i for i in asset_ids if i]
    while queue:
        batch = [i for i in queue if i not in seen]
        queue = []
        for asset in Asset.objects.filter(pk__in=batch).select_related("account"):
            seen[asset.pk] = asset
            for child in (asset.meta or {}).get("inputs") or []:
                if isinstance(child, int) and child not in seen:
                    queue.append(child)
    return list(seen.values())


def version_input_assets(version: ContentVersion) -> list[Asset]:
    return expand(_direct_ids(version))


def uses_ai_generated(version: ContentVersion) -> bool:
    return any(a.origin == "ai_generated" for a in version_input_assets(version))


def inherited_rights(input_ids) -> tuple[str, object]:
    """(worst effective status, earliest expiry) of the inputs; `cleared` without inputs."""
    assets = expand(input_ids)
    if not assets:
        return "cleared", None
    status = worst_rights(effective_rights(a) for a in assets)
    expiries = [a.rights_expires_at for a in assets if a.rights_expires_at]
    return status, (min(expiries) if expiries else None)
