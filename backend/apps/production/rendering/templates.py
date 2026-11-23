"""Render template registry: loads and validates `render_templates/*/meta.json` (E06-S02)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "render_templates"
TEMPLATE_KEYS = ("title", "statement", "stat", "list", "quote", "image_caption", "cta")
IMAGE_SLOTS = ("none", "optional", "required")


class TemplateNotFound(Exception):
    pass


@dataclass(frozen=True)
class RenderTemplate:
    key: str
    name: str
    description: str
    version: str
    image_slot: str
    scrim: str
    layouts: tuple[str, ...]
    fields: dict

    @property
    def directory(self) -> Path:
        return TEMPLATES_DIR / self.key

    def field_limits(self) -> dict:
        """Field limits as served by the API (without the renderer's font sizes)."""
        out = {}
        for name, spec in self.fields.items():
            out[name] = {k: v for k, v in spec.items() if k != "font"}
        return out

    def fit_for(self, layout: str) -> dict:
        fit = {}
        for name, spec in self.fields.items():
            font = spec["font"][layout]
            fit[name] = {"max_font": font["max_font"], "min_font": font["min_font"],
                         "max_lines": spec.get("max_lines", 0)}
        return fit


def _load(key: str) -> RenderTemplate:
    path = TEMPLATES_DIR / key / "meta.json"
    if not path.exists():
        raise TemplateNotFound(key)
    meta = json.loads(path.read_text(encoding="utf-8"))
    return RenderTemplate(
        key=meta["key"], name=meta["name"], description=meta["description"],
        version=str(meta["version"]), image_slot=meta["image_slot"], scrim=meta["scrim"],
        layouts=tuple(meta["layouts"]), fields=meta["fields"],
    )


@lru_cache(maxsize=None)
def all_templates() -> tuple[RenderTemplate, ...]:
    return tuple(_load(key) for key in TEMPLATE_KEYS)


def get_template(key: str) -> RenderTemplate:
    for template in all_templates():
        if template.key == key:
            return template
    raise TemplateNotFound(key)


def layouts() -> tuple[str, ...]:
    """Layout keys come from the format registry (E04-S01 rule 8), never from literals here."""
    from apps.content import formats

    return tuple(sorted({spec.layout for spec in formats.all_specs()}))


def validate_registry() -> list[str]:
    """Problems with the template files; used by a system check at startup."""
    problems: list[str] = []
    for key in TEMPLATE_KEYS:
        try:
            template = _load(key)
        except TemplateNotFound:
            problems.append(f"render template {key}: meta.json missing")
            continue
        except (KeyError, ValueError) as exc:
            problems.append(f"render template {key}: invalid meta.json ({exc})")
            continue
        if template.key != key:
            problems.append(f"render template {key}: meta key {template.key!r} does not match")
        if template.image_slot not in IMAGE_SLOTS:
            problems.append(f"render template {key}: image_slot {template.image_slot!r}")
        if template.scrim not in ("dark", "brand"):
            problems.append(f"render template {key}: scrim {template.scrim!r}")
        for name in ("headline", "body"):
            spec = template.fields.get(name)
            if spec is None:
                problems.append(f"render template {key}: field {name} missing")
                continue
            for layout in layouts():
                font = spec.get("font", {}).get(layout)
                if not font or font["min_font"] > font["max_font"]:
                    problems.append(f"render template {key}: field {name} font for {layout}")
        for layout in template.layouts:
            if not (template.directory / f"layout-{layout}.html.j2").exists():
                problems.append(f"render template {key}: layout-{layout}.html.j2 missing")
        if not (template.directory / "style.css").exists():
            problems.append(f"render template {key}: style.css missing")
    return problems
