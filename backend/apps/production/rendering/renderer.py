"""HTML template to PNG renderer (E06-S02 rules 9-22).

The renderer is a pure function of its inputs: it writes the page, fonts, logo and background into
a fresh temporary directory, opens it in headless Chromium through Playwright, blocks every
request outside that directory, runs `fit.js`, and takes a screenshot. It knows nothing about the
database; `production.services.frames` turns content versions into `RenderRequest`s.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from .brand import BrandContext
from .templates import TEMPLATES_DIR, get_template

logger = logging.getLogger(__name__)

RENDERER_VERSION = "1"
RENDER_TIMEOUT_MS = 30_000
RESTART_AFTER_RENDERS = 200

_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    undefined=StrictUndefined,
    autoescape=select_autoescape(["j2", "html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


class RenderError(Exception):
    """A render that failed in a way a retry may fix (crash, timeout)."""


@dataclass
class RenderRequest:
    template_key: str
    layout: str
    width: int
    height: int
    safe_area: dict
    headline: str
    body: str
    brand: BrandContext
    lang: str = "fa"
    background_path: Path | None = None
    logo_variant: str = "auto"
    text_backdrop: bool = False
    overlay: bool = False
    debug_boxes: bool = False


@dataclass
class RenderResult:
    png: bytes
    fit: dict
    warnings: list[dict] = field(default_factory=list)


def _copy_file(src, dest: Path) -> None:
    """Copy a Path or a Django FieldFile into `dest`."""
    if isinstance(src, (str, Path)):
        shutil.copyfile(src, dest)
        return
    src.open("rb")
    try:
        with open(dest, "wb") as out:
            for chunk in src.chunks():
                out.write(chunk)
    finally:
        src.close()


def _suffix(src) -> str:
    name = str(src) if isinstance(src, (str, Path)) else getattr(src, "name", "")
    suffix = Path(name).suffix.lower()
    return suffix if suffix in (".png", ".svg", ".jpg", ".jpeg", ".webp") else ".png"


def build_page(request: RenderRequest, directory: Path) -> tuple[Path, list[dict]]:
    """Write the HTML page and its assets into `directory`. Returns the page and warnings."""
    template = get_template(request.template_key)
    warnings: list[dict] = []
    has_image = template.image_slot != "none" and request.background_path is not None
    if request.overlay:
        has_image = False

    (directory / "fonts").mkdir()
    faces = []
    seen = set()
    for font in (request.brand.heading_font(), request.brand.body_font(),
                 request.brand.fallback_font()):
        if font.key in seen:
            continue
        seen.add(font.key)
        for weight, path in font.files.items():
            dest = directory / "fonts" / path.name
            shutil.copyfile(path, dest)
            faces.append({"family": font.family, "src": f"fonts/{path.name}", "weight": weight})

    shutil.copyfile(TEMPLATES_DIR / "_base" / "base.css", directory / "base.css")
    shutil.copyfile(TEMPLATES_DIR / "_base" / "fit.js", directory / "fit.js")
    shutil.copyfile(template.directory / "style.css", directory / "style.css")

    background_src = ""
    if has_image:
        background_src = "background" + _suffix(request.background_path)
        _copy_file(request.background_path, directory / background_src)

    logo_file, _variant = request.brand.logo_for(
        has_image=has_image, scrim=template.scrim, variant=request.logo_variant)
    logo_src = ""
    if logo_file:
        logo_src = "logo" + _suffix(logo_file)
        try:
            _copy_file(logo_file, directory / logo_src)
        except Exception:  # noqa: BLE001 - a missing logo file renders as no logo
            logo_src = ""
    if not logo_src:
        warnings.append({"code": "logo_not_configured", "message": "No logo in the brand profile."})

    items = [line.strip() for line in request.body.splitlines() if line.strip()]
    brand = request.brand
    context = {
        "template_key": template.key,
        "layout": request.layout,
        "width": request.width,
        "height": request.height,
        "lang": request.lang,
        "dir": "rtl" if request.lang == "fa" else "ltr",
        "overlay": request.overlay,
        "has_image": has_image,
        "text_backdrop": request.text_backdrop,
        "debug_boxes": request.debug_boxes,
        "font_faces": faces,
        "brand": {
            "colors": brand.colors,
            "on_primary": _readable(brand.colors["primary"]),
            "on_accent": _readable(brand.colors["accent"]),
            "on_image": brand.on_image(template.scrim),
            "scrim_color": brand.scrim_color(template.scrim),
            "font_heading": brand.heading_font().family,
            "font_body": brand.body_font().family,
            "font_fallback": brand.fallback_font().family,
        },
        "safe": request.safe_area,
        "background_src": background_src,
        "logo_src": logo_src,
        "handle": brand.handle,
        "headline": request.headline,
        "body": request.body,
        "items": items,
        "fit": template.fit_for(request.layout),
    }
    html = _env.get_template(f"{template.key}/layout-{request.layout}.html.j2").render(**context)
    page = directory / "index.html"
    page.write_text(html, encoding="utf-8")
    return page, warnings


def _readable(hex_color: str) -> str:
    from .brand import readable_on

    return readable_on(hex_color)


class _Browser:
    """One Chromium per worker process, restarted after 200 renders or a crash (rule 22)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._playwright = None
        self._browser = None
        self._renders = 0

    def _start(self):
        from playwright.sync_api import sync_playwright

        self._playwright = sync_playwright().start()
        executable = os.environ.get("SOCIALHUB_CHROMIUM_PATH") or os.environ.get("CHROME_BIN")
        kwargs = {"args": ["--font-render-hinting=none", "--disable-gpu",
                           "--disable-dev-shm-usage", "--force-color-profile=srgb"]}
        if executable:
            kwargs["executable_path"] = executable
        self._browser = self._playwright.chromium.launch(**kwargs)
        self._renders = 0

    def stop(self):
        try:
            if self._browser is not None:
                self._browser.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            if self._playwright is not None:
                self._playwright.stop()
        except Exception:  # noqa: BLE001
            pass
        self._browser = None
        self._playwright = None

    def browser(self):
        if self._browser is None or not self._browser.is_connected() or (
                self._renders >= RESTART_AFTER_RENDERS):
            self.stop()
            self._start()
        self._renders += 1
        return self._browser


_BROWSER = _Browser()
# Playwright's sync API runs an asyncio loop in the thread that uses it, which makes Django
# refuse database access in that thread. Every browser call therefore runs on this one
# dedicated thread; callers (Celery tasks, tests) only wait for the result.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="socialhub-chromium")


def _screenshot(page_path: Path, root_url: str, request: RenderRequest) -> tuple[bytes, dict]:
    try:
        browser = _BROWSER.browser()
        context = browser.new_context(
            viewport={"width": request.width, "height": request.height},
            device_scale_factor=1,
            java_script_enabled=True,
            locale="fa-IR" if request.lang == "fa" else "en-US",
        )
        try:
            page = context.new_page()
            page.set_default_timeout(RENDER_TIMEOUT_MS)
            page.route("**/*", lambda route: route.continue_()
                       if route.request.url.startswith(root_url) else route.abort())
            page.goto(page_path.resolve().as_uri(), wait_until="load")
            page.evaluate("() => document.fonts.ready.then(() => true)")
            page.evaluate(
                "() => Promise.all(Array.from(document.images).map(img => img.complete"
                " ? true : new Promise(r => { img.onload = img.onerror = r; })))")
            report = page.evaluate("() => window.__fit()")
            png = page.screenshot(type="png", full_page=False, omit_background=request.overlay)
        finally:
            context.close()
    except Exception as exc:
        if exc.__class__.__module__.startswith("playwright"):
            logger.warning("Render failed, restarting Chromium: %s", exc)
            _BROWSER.stop()
            raise RenderError(str(exc)) from exc
        raise
    return png, report


def render(request: RenderRequest) -> RenderResult:
    """Render one frame. Raises `RenderError` for crashes and timeouts (retryable)."""
    work_root = os.environ.get("SOCIALHUB_WORK_DIR") or None
    directory = Path(tempfile.mkdtemp(prefix="socialhub-render-", dir=work_root))
    try:
        page_path, warnings = build_page(request, directory)
        root_url = directory.resolve().as_uri() + "/"
        future = _EXECUTOR.submit(_screenshot, page_path, root_url, request)
        try:
            png, report = future.result(timeout=RENDER_TIMEOUT_MS / 1000 * 2)
        except FutureTimeout:
            raise RenderError("The render took longer than allowed.") from None
        for slot in report.get("overflow", []):
            warnings.append({"code": "text_overflow",
                             "message": "Text does not fit. Shorten it or choose another template.",
                             "field": slot})
        return RenderResult(png=png, fit=report.get("fit", {}), warnings=warnings)
    finally:
        shutil.rmtree(directory, ignore_errors=True)
