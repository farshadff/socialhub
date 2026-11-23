"""Resolve bundled font keys to files for the renderer.

The bundled font list belongs to E00-S03 (`apps/core/fonts/`). Until its registry module lands,
this reads the same files directly. Vazirmatn is always added as the fallback (E06-S02 rule 6).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

FONT_FILES_DIR = Path(__file__).resolve().parents[2] / "core" / "fonts" / "files"

_FONTS = {
    "vazirmatn": ("Vazirmatn", "woff2"),
    "noto-sans-arabic": ("Noto Sans Arabic", "ttf"),
    "noto-naskh-arabic": ("Noto Naskh Arabic", "ttf"),
    "inter": ("Inter", "woff2"),
    "noto-sans": ("Noto Sans", "ttf"),
}
FALLBACK_KEY = "vazirmatn"
WEIGHTS = (400, 700)


@dataclass(frozen=True)
class BundledFont:
    key: str
    name: str
    files: dict[int, Path]

    @property
    def family(self) -> str:
        # A private family name so a system font with the same name can never be picked up.
        return f"SH {self.name}"


def font_keys() -> tuple[str, ...]:
    return tuple(_FONTS)


def get_font(key: str) -> BundledFont:
    try:
        from apps.core.fonts import registry as core_fonts  # E00-S03 registry, when present

        if hasattr(core_fonts, "get_font"):
            info = core_fonts.get_font(key)
            files = {int(w): Path(p) for w, p in info["files"].items()}
            return BundledFont(key=info["key"], name=info["name"], files=files)
    except (ImportError, KeyError):
        pass
    if key not in _FONTS:
        raise KeyError(key)
    name, ext = _FONTS[key]
    return BundledFont(key=key, name=name,
                       files={w: FONT_FILES_DIR / f"{key}-{w}.{ext}" for w in WEIGHTS})
