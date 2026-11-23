"""Brand context for rendering (E06-S02 rules 5-8)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from . import fonts

DEFAULT_COLORS = {"primary": "#1677FF", "secondary": "#666666", "accent": "#1677FF",
                  "background": "#FFFFFF", "text": "#111111"}
NEUTRAL_DARK = "#000000"
NEUTRAL_LIGHT = "#FFFFFF"
NEUTRAL_INK = "#111111"
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def relative_luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def is_dark(hex_color: str) -> bool:
    return relative_luminance(hex_color) < 0.5


def readable_on(hex_color: str) -> str:
    return NEUTRAL_LIGHT if is_dark(hex_color) else NEUTRAL_INK


@dataclass
class BrandContext:
    colors: dict
    font_heading_key: str
    font_body_key: str
    handle: str
    logo_light: object | None = None  # a FieldFile or path-like, or None
    logo_dark: object | None = None
    logo_light_checksum: str = ""
    logo_dark_checksum: str = ""
    warnings: list[dict] = field(default_factory=list)

    # Derived values used by the base template.
    def heading_font(self) -> fonts.BundledFont:
        return fonts.get_font(self.font_heading_key)

    def body_font(self) -> fonts.BundledFont:
        return fonts.get_font(self.font_body_key)

    def fallback_font(self) -> fonts.BundledFont:
        return fonts.get_font(fonts.FALLBACK_KEY)

    def scrim_color(self, scrim: str) -> str:
        return NEUTRAL_DARK if scrim == "dark" else self.colors["background"]

    def on_image(self, scrim: str) -> str:
        return readable_on(self.scrim_color(scrim))

    def logo_for(self, *, has_image: bool, scrim: str, variant: str) -> tuple[object | None, str]:
        """The logo file and which variant it is (rule 7)."""
        if variant not in ("light", "dark"):
            surface = self.scrim_color(scrim) if has_image else self.colors["background"]
            variant = "dark" if is_dark(surface) else "light"
        first, second = (self.logo_dark, self.logo_light) if variant == "dark" else (
            self.logo_light, self.logo_dark)
        if first:
            return first, variant
        if second:
            return second, "light" if variant == "dark" else "dark"
        return None, ""

    def fingerprint(self) -> dict:
        """Everything about the brand that changes pixels; part of the input hash (rule 17)."""
        return {
            "colors": self.colors,
            "fonts": [self.font_heading_key, self.font_body_key],
            "handle": self.handle,
            "logo_light": self.logo_light_checksum,
            "logo_dark": self.logo_dark_checksum,
        }


def _file_checksum(file) -> str:
    if not file:
        return ""
    try:
        file.open("rb")
        digest = hashlib.sha256()
        for chunk in file.chunks():
            digest.update(chunk)
        file.close()
        return digest.hexdigest()
    except Exception:  # noqa: BLE001 - a missing file renders as no logo
        return ""


def build_brand_context(account) -> BrandContext:
    """Read the account's brand profile with fallbacks; never raises for missing values."""
    profile = getattr(account, "brand_profile", None) or getattr(account, "brand", None)
    warnings: list[dict] = []
    colors = dict(DEFAULT_COLORS)
    raw_colors = getattr(profile, "colors", None) or {}
    incomplete = False
    for name in DEFAULT_COLORS:
        value = raw_colors.get(name)
        if isinstance(value, str) and _HEX.match(value):
            colors[name] = value.upper()
        else:
            incomplete = True
    if incomplete:
        # Neutral defaults: text #111111 on #FFFFFF, primary #1677FF (rule 8).
        warnings.append({"code": "brand_incomplete",
                         "message": "Brand colours are incomplete; defaults were used."})
    raw_fonts = getattr(profile, "fonts", None) or {}
    heading = raw_fonts.get("heading") if raw_fonts.get("heading") in fonts.font_keys() else fonts.FALLBACK_KEY
    body = raw_fonts.get("body") if raw_fonts.get("body") in fonts.font_keys() else fonts.FALLBACK_KEY
    handle = getattr(profile, "handle_display", "") or f"@{account.handle}"
    logo_light = getattr(profile, "logo_light", None) or None
    logo_dark = getattr(profile, "logo_dark", None) or None
    return BrandContext(
        colors=colors, font_heading_key=heading, font_body_key=body, handle=handle,
        logo_light=logo_light, logo_dark=logo_dark,
        logo_light_checksum=_file_checksum(logo_light),
        logo_dark_checksum=_file_checksum(logo_dark),
        warnings=warnings,
    )
