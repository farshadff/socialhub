"""Brand profile helpers: contrast warnings (S03 rule 20) and the AI prompt brand block.

Public names: `contrast_ratio`, `brand_warnings`, `render_brand_block`, `LOW_CONTRAST_MIN`.
"""

from __future__ import annotations

from .models import InstagramAccount
from .schemas import COLOR_KEYS, FONT_KEYS

LOW_CONTRAST_MIN = 4.5
_LANGUAGES = {"fa": "Persian", "en": "English"}


def _channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_color: str) -> float:
    """WCAG 2 relative luminance of `#RRGGBB`."""
    value = hex_color.lstrip("#")
    r, g, b = (_channel(int(value[i:i + 2], 16)) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(foreground: str, background: str) -> float:
    """WCAG 2 contrast ratio between two `#RRGGBB` colours, from 1.0 to 21.0."""
    a, b = relative_luminance(foreground), relative_luminance(background)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


def brand_warnings(colors: dict) -> list[dict]:
    """Non-blocking warnings for a brand's colours; MVP has one, `low_contrast` on `colors.text`."""
    ratio = contrast_ratio(colors["text"], colors["background"])
    if ratio >= LOW_CONTRAST_MIN:
        return []
    return [{
        "path": "colors.text",
        "code": "low_contrast",
        "message": (f"Text on background contrast is {ratio:.2f}:1; "
                    f"{LOW_CONTRAST_MIN}:1 or more is recommended."),
    }]


def _text(value) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return text or "(not set)"


def _items(values) -> list[str]:
    values = [str(v).strip() for v in (values or []) if str(v).strip()]
    return [f"- {v}" for v in values] or ["- (none)"]


def render_brand_block(account: InstagramAccount) -> str:
    """The account's brand as a fixed-order text block for the cached AI prompt prefix.

    Deterministic: the same brand always gives the same string. It holds no IDs or timestamps
    (AI-INTEGRATION.md, "Prompt caching"; E00-S05 rule 9). Section order is fixed: tone of
    voice, audience, content pillars, banned terms, CTA examples, handle, content language,
    colours, fonts.
    """
    brand = account.brand
    colors = brand.colors or {}
    fonts = brand.fonts or {}
    language = account.content_language
    lines = [
        "# Brand profile",
        "",
        "## Tone of voice",
        _text(brand.tone_of_voice),
        "",
        "## Audience",
        _text(brand.audience_summary),
        "",
        "## Content pillars",
        *_items(brand.content_pillars),
        "",
        "## Banned terms",
        *_items(brand.banned_terms),
        "",
        "## CTA examples",
        *_items(brand.cta_examples),
        "",
        "## Handle",
        _text(brand.handle_display or f"@{account.handle}"),
        "",
        "## Content language",
        f"{language} ({_LANGUAGES.get(language, language)})",
        "",
        "## Colours",
        *[f"- {key}: {str(colors.get(key, '')).upper() or '(not set)'}" for key in COLOR_KEYS],
        "",
        "## Fonts",
        *[f"- {key}: {fonts.get(key) or '(not set)'}" for key in FONT_KEYS],
    ]
    return "\n".join(lines) + "\n"
