"""The bundled font registry (E00-S03 rule 24).

Every font here ships with the backend under an open licence (`files/OFL.txt`) in a regular
(400) and a bold (700) file. Brand profiles store font keys; the render templates (E06-S02) and
`GET /fonts/` read the files through this module. The files are also static files under
`static/fonts/` (`STATICFILES_DIRS` in config/settings.py), so the panel can load them.

Public names: `FONTS_DIR`, `STATIC_PREFIX`, `font_keys`, `list_fonts`, `get_font`, `is_font_key`,
`static_path`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

FONTS_DIR = Path(__file__).resolve().parent / "files"
STATIC_PREFIX = "fonts"
WEIGHTS = (400, 700)


@dataclass(frozen=True)
class _Font:
    key: str
    name: str
    scripts: tuple[str, ...]
    ext: str

    def path(self, weight: int) -> Path:
        return FONTS_DIR / f"{self.key}-{weight}.{self.ext}"


_FONTS: tuple[_Font, ...] = (
    _Font("vazirmatn", "Vazirmatn", ("arabic", "latin"), "woff2"),
    _Font("noto-sans-arabic", "Noto Sans Arabic", ("arabic",), "ttf"),
    _Font("noto-naskh-arabic", "Noto Naskh Arabic", ("arabic",), "ttf"),
    _Font("inter", "Inter", ("latin",), "woff2"),
    _Font("noto-sans", "Noto Sans", ("latin",), "ttf"),
)
_BY_KEY = {font.key: font for font in _FONTS}


def font_keys() -> tuple[str, ...]:
    return tuple(_BY_KEY)


def is_font_key(key) -> bool:
    return isinstance(key, str) and key in _BY_KEY


def _as_dict(font: _Font) -> dict:
    return {
        "key": font.key,
        "name": font.name,
        "family": font.name,  # the family name inside the font files
        "scripts": list(font.scripts),
        "weights": list(WEIGHTS),
        "files": {weight: font.path(weight) for weight in WEIGHTS},
    }


def get_font(key: str) -> dict:
    """`{key, name, family, scripts, weights, files: {400: Path, 700: Path}}`.

    Raises `KeyError` for a key that is not bundled.
    """
    return _as_dict(_BY_KEY[key])


def list_fonts() -> list[dict]:
    """Every bundled font in display order, each shaped like `get_font`."""
    return [_as_dict(font) for font in _FONTS]


def static_path(key: str, weight: int) -> str:
    """The static-files path of one font file, for example `fonts/vazirmatn-400.woff2`."""
    return f"{STATIC_PREFIX}/{_BY_KEY[key].path(weight).name}"
