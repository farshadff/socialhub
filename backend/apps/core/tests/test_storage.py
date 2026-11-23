"""E00-S06 media storage, settings rules and upload validation tests."""

import hashlib
import struct
import zlib
from datetime import UTC, datetime
from pathlib import Path

import boto3
import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from moto import mock_aws

from apps.core import storage
from apps.core.errors import PayloadTooLarge, UnsupportedMedia
from apps.core.jobs import JobError
from apps.core.uploads import AUDIO, IMAGE, VIDEO, UploadProfile, validate_upload
from config.media import build_media_settings

# --- fixture bytes (built in code; no binary files in the repository) -----------------------


def png_bytes() -> bytes:
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


FILES = {
    "png": png_bytes(),
    "jpg": b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\0" * 64,
    "webp": b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\0" * 64,
    "mp4": b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\0" * 64,
    "mov": b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\0" * 64,
    "mp3": b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\0" * 64,
    "wav": b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\0" * 64,
    "m4a": b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A isom" + b"\0" * 64,
}


def upload(name: str, content: bytes, content_type="application/octet-stream"):
    return SimpleUploadedFile(name, content, content_type=content_type)


# --- validate_upload ------------------------------------------------------------------------


@pytest.mark.parametrize("name,kind,profile,mime,ext", [
    ("photo.png", "png", IMAGE, "image/png", "png"),
    ("photo.JPEG", "jpg", IMAGE, "image/jpeg", "jpg"),
    ("photo.webp", "webp", IMAGE, "image/webp", "webp"),
    ("clip.mp4", "mp4", VIDEO, "video/mp4", "mp4"),
    ("clip.MOV", "mov", VIDEO, "video/quicktime", "mov"),
    ("song.mp3", "mp3", AUDIO, "audio/mpeg", "mp3"),
    ("song.wav", "wav", AUDIO, "audio/x-wav", "wav"),
    ("song.m4a", "m4a", AUDIO, "audio/mp4", "m4a"),
])
def test_valid_uploads(name, kind, profile, mime, ext):
    content = FILES[kind]
    info = validate_upload(upload(name, content, content_type="text/plain"), profile)
    assert (info.mime, info.ext, info.bytes) == (mime, ext, len(content))
    assert info.sha256 == hashlib.sha256(content).hexdigest()


def test_png_named_jpg_is_extension_mismatch():
    with pytest.raises(UnsupportedMedia) as excinfo:
        validate_upload(upload("photo.jpg", FILES["png"], "image/jpeg"), IMAGE)
    assert excinfo.value.reason == "extension_mismatch"


def test_text_named_mp4_is_type_not_allowed():
    with pytest.raises(UnsupportedMedia) as excinfo:
        validate_upload(upload("clip.mp4", b"just some text, not a video" * 10), VIDEO)
    assert excinfo.value.reason == "type_not_allowed"


def test_image_in_video_profile_is_type_not_allowed():
    with pytest.raises(UnsupportedMedia) as excinfo:
        validate_upload(upload("photo.png", FILES["png"]), VIDEO)
    assert excinfo.value.reason == "type_not_allowed"


def test_empty_file():
    with pytest.raises(UnsupportedMedia) as excinfo:
        validate_upload(upload("photo.png", b""), IMAGE, field="logo")
    assert excinfo.value.reason == "empty_file"
    assert excinfo.value.fields[0]["path"] == "logo"


def test_oversized_file_is_refused_before_reading():
    class Unreadable(SimpleUploadedFile):
        def read(self, *args, **kwargs):  # pragma: no cover - must not be called
            raise AssertionError("file was read")

        def chunks(self, *args, **kwargs):  # pragma: no cover - must not be called
            raise AssertionError("file was read")

    small_video = UploadProfile("video", VIDEO.types, max_bytes=100)
    with pytest.raises(PayloadTooLarge):
        validate_upload(Unreadable("big.mp4", FILES["mp4"] * 10), small_video)


def test_upload_errors_render_the_contract():
    """Through the API: 400 unsupported_media with a reason; 413 payload_too_large."""
    from django.urls import path
    from rest_framework.decorators import api_view, parser_classes, permission_classes
    from rest_framework.parsers import MultiPartParser
    from rest_framework.permissions import AllowAny
    from rest_framework.response import Response

    @api_view(["POST"])
    @permission_classes([AllowAny])
    @parser_classes([MultiPartParser])
    def view(request):
        profile = UploadProfile("image", IMAGE.types, max_bytes=int(request.query_params["max"]))
        info = validate_upload(request.FILES["file"], profile)
        return Response({"sha256": info.sha256})

    urls = type("urls", (), {"urlpatterns": [path("api/v1/upload/", view)]})
    with override_settings(ROOT_URLCONF=urls):
        from rest_framework.test import APIClient

        client = APIClient()
        response = client.post("/api/v1/upload/?max=1000000",
                               {"file": upload("photo.jpg", FILES["png"])}, format="multipart")
        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "unsupported_media"
        assert error["fields"][0]["path"] == "file"
        assert error["fields"][0]["reason"] == "extension_mismatch"
        assert error["details"] == {"reasons": ["extension_mismatch"]}

        response = client.post("/api/v1/upload/?max=10",
                               {"file": upload("photo.png", FILES["png"])}, format="multipart")
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "payload_too_large"


# --- keys -----------------------------------------------------------------------------------

NOV = datetime(2026, 11, 23, 9, 0, tzinfo=UTC)


@pytest.mark.parametrize("filename,ext,expected", [
    ("عکس.PNG", "png", "accounts/3/2026/11/418-file.png"),
    ("عکس.PNG", None, "accounts/3/2026/11/418-file.png"),
    ("Entryway Reel FINAL.mp4", "mp4", "accounts/3/2026/11/418-entryway-reel-final.mp4"),
    ("ورودی entryway ۲.jpeg", "jpg", "accounts/3/2026/11/418-entryway.jpg"),
    ("photo.JPG", "jpg", "accounts/3/2026/11/418-photo.jpg"),
    ("a" * 60 + ".png", "png", "accounts/3/2026/11/418-" + "a" * 40 + ".png"),
    ("../../etc/passwd.png", "png", "accounts/3/2026/11/418-passwd.png"),
])
def test_asset_key(filename, ext, expected):
    assert storage.asset_key(3, 418, filename, NOV, ext=ext) == expected


def test_asset_key_month_is_utc():
    from zoneinfo import ZoneInfo

    local = datetime(2026, 12, 1, 2, 0, tzinfo=ZoneInfo("Asia/Tehran"))  # 30 Nov UTC
    assert storage.asset_key(3, 1, "a.png", local) == "accounts/3/2026/11/1-a.png"


def test_brand_key():
    key = storage.brand_key(3, "light", "PNG")
    prefix, _, rest = key.rpartition("logo-light-")
    assert prefix == "accounts/3/brand/"
    hex_part, ext = rest.split(".")
    assert len(hex_part) == 8 and int(hex_part, 16) >= 0 and ext == "png"
    assert storage.brand_key(3, "light", "png") != key


# --- local backend --------------------------------------------------------------------------


def test_local_media_url_and_local_copy(settings, tmp_path):
    settings.SOCIALHUB_MEDIA_BACKEND = "local"
    settings.SOCIALHUB_MEDIA_BASE_URL = "http://localhost:8000/media/"
    key = storages["default"].save("accounts/3/2026/11/1-a.png", ContentFile(FILES["png"]))
    assert storage.media_url(key) == f"http://localhost:8000/media/{key}"
    with storage.local_copy(key) as path:
        assert path.read_bytes() == FILES["png"]
        assert path == Path(storages["default"].path(key))
    assert path.exists()  # the stored file itself is never deleted
    assert storage.storage_status() == {"backend": "local", "bucket": None,
                                        "public_base_url": "http://localhost:8000/media/"}


def test_media_url_field():
    field = storage.MediaURLField()
    assert field.to_representation("") is None
    assert field.to_representation("a/b.png").endswith("/a/b.png")


def test_work_dir_is_removed(settings, tmp_path):
    settings.SOCIALHUB_WORK_DIR = str(tmp_path)
    with pytest.raises(RuntimeError):
        with storage.work_dir("job-1") as path:
            assert path.is_dir() and not any(path.iterdir())
            assert path.name.startswith("socialhub-job-1-")
            (path / "out.png").write_bytes(b"x")
            raise RuntimeError("boom")
    assert not path.exists()


# --- s3 backend (moto) ----------------------------------------------------------------------

S3_ENV = {
    "SOCIALHUB_MEDIA_BACKEND": "s3",
    "SOCIALHUB_S3_BUCKET": "socialhub-media",
    "SOCIALHUB_S3_ACCESS_KEY_ID": "testing",
    "SOCIALHUB_S3_SECRET_ACCESS_KEY": "testing",
    "SOCIALHUB_MEDIA_URL_TTL_SECONDS": "21600",
}


@pytest.fixture
def s3(tmp_path, monkeypatch):
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    with mock_aws():
        boto3.client("s3", region_name="us-east-1",
                     aws_access_key_id="testing", aws_secret_access_key="testing"
                     ).create_bucket(Bucket="socialhub-media")
        values = build_media_settings(S3_ENV, debug=False, media_root=tmp_path)
        values["SOCIALHUB_WORK_DIR"] = str(tmp_path / "work")
        (tmp_path / "work").mkdir()
        with override_settings(**values):
            yield storages["default"]


def test_s3_presigned_url(s3):
    key = s3.save("accounts/3/2026/11/1-a.png", ContentFile(FILES["png"]))
    url = storage.media_url(key)
    assert "socialhub-media" in url and key in url
    assert "X-Amz-Signature=" in url
    assert "X-Amz-Expires=21600" in url
    assert "X-Amz-Expires=7200" in storage.media_url(key, ttl=7200)
    assert storage.storage_status() == {"backend": "s3", "bucket": "socialhub-media",
                                        "public_base_url": None}


def test_s3_objects_are_private_with_content_type(s3):
    key = s3.save("accounts/3/2026/11/1-a.png", ContentFile(FILES["png"]))
    client = boto3.client("s3", region_name="us-east-1",
                          aws_access_key_id="testing", aws_secret_access_key="testing")
    head = client.head_object(Bucket="socialhub-media", Key=key)
    assert head["ContentType"] == "image/png"
    grants = client.get_object_acl(Bucket="socialhub-media", Key=key)["Grants"]
    assert all("AllUsers" not in str(grant.get("Grantee")) for grant in grants)


def test_s3_public_base_url(s3, settings):
    settings.SOCIALHUB_S3_PUBLIC_BASE_URL = "https://cdn.example.com/media/"
    assert (storage.media_url("accounts/3/2026/11/1-a.png")
            == "https://cdn.example.com/media/accounts/3/2026/11/1-a.png")


def test_s3_local_copy_streams_checks_and_cleans_up(s3, tmp_path):
    key = s3.save("accounts/3/2026/11/1-a.png", ContentFile(FILES["png"]))
    digest = hashlib.sha256(FILES["png"]).hexdigest()
    with storage.local_copy(key, expected_sha256=digest) as path:
        assert path.read_bytes() == FILES["png"]
        assert str(path).startswith(str(tmp_path / "work"))
    assert not path.parent.exists()

    with pytest.raises(RuntimeError):
        with storage.local_copy(key) as path:
            raise RuntimeError("worker failed")
    assert not path.parent.exists()

    with pytest.raises(JobError) as excinfo:
        with storage.local_copy(key, expected_sha256="0" * 64):
            pass  # pragma: no cover
    assert excinfo.value.code == "media_checksum_mismatch"
    assert not any((tmp_path / "work").iterdir())


# --- startup rules (rules 26-27) ------------------------------------------------------------


def test_local_backend_refused_without_debug(tmp_path):
    with pytest.raises(ImproperlyConfigured, match="SOCIALHUB_MEDIA_BACKEND"):
        build_media_settings({"SOCIALHUB_MEDIA_BACKEND": "local"}, debug=False,
                             media_root=tmp_path)
    assert build_media_settings({}, debug=True, media_root=tmp_path)[
        "SOCIALHUB_MEDIA_BACKEND"] == "local"


@pytest.mark.parametrize("missing", ["SOCIALHUB_S3_BUCKET", "SOCIALHUB_S3_ACCESS_KEY_ID",
                                     "SOCIALHUB_S3_SECRET_ACCESS_KEY"])
def test_s3_backend_requires_settings(tmp_path, missing):
    env = {k: v for k, v in S3_ENV.items() if k != missing}
    with pytest.raises(ImproperlyConfigured, match=missing):
        build_media_settings(env, debug=False, media_root=tmp_path)


def test_unknown_backend_refused(tmp_path):
    with pytest.raises(ImproperlyConfigured, match="SOCIALHUB_MEDIA_BACKEND"):
        build_media_settings({"SOCIALHUB_MEDIA_BACKEND": "ftp"}, debug=True, media_root=tmp_path)


def test_s3_options(tmp_path):
    env = {**S3_ENV, "SOCIALHUB_S3_ENDPOINT_URL": "https://minio.example.com",
           "SOCIALHUB_S3_ADDRESSING_STYLE": "virtual", "SOCIALHUB_S3_REGION": "eu-west-1"}
    options = build_media_settings(env, debug=False, media_root=tmp_path)["STORAGES"][
        "default"]["OPTIONS"]
    assert options["endpoint_url"] == "https://minio.example.com"
    assert options["addressing_style"] == "virtual"
    assert options["region_name"] == "eu-west-1"
    assert options["default_acl"] is None
    assert options["querystring_expire"] == 21600
