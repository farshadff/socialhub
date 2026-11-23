"""Vision input preparation (E00-S05 rule 16): downscale and re-encode before sending."""

from __future__ import annotations

import hashlib
import io

from .providers.base import PreparedImage

MAX_IMAGES = 8
MAX_LONG_SIDE = 1568
JPEG_QUALITY = 90


def _has_alpha(image) -> bool:
    if image.mode in ("RGBA", "LA", "PA"):
        return image.getextrema()[-1][0] < 255 if image.mode != "PA" else True
    return image.mode == "P" and "transparency" in image.info


def prepare_image(content: bytes) -> PreparedImage:
    """At most 1568 px on the long side; JPEG q90, or PNG when the image has transparency."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(content)) as source:
        source.load()
        image = ImageOps.exif_transpose(source) or source
        transparent = _has_alpha(image)
        if max(image.size) > MAX_LONG_SIDE:
            image = image.copy()
            image.thumbnail((MAX_LONG_SIDE, MAX_LONG_SIDE), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        if transparent:
            image.convert("RGBA").save(buffer, format="PNG", optimize=True)
            media_type = "image/png"
        else:
            image.convert("RGB").save(buffer, format="JPEG", quality=JPEG_QUALITY)
            media_type = "image/jpeg"
    data = buffer.getvalue()
    return PreparedImage(data=data, media_type=media_type,
                         sha256=hashlib.sha256(data).hexdigest())
