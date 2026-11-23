FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg provides ffprobe for upload probing (E00-S06, E06-S01) and the format check (E07-S02).
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.lock /tmp/requirements.lock
RUN python -m pip install --require-hashes -r /tmp/requirements.lock \
    && rm /tmp/requirements.lock \
    && groupadd --system --gid 10001 socialhub \
    && useradd --system --uid 10001 --gid socialhub --create-home socialhub \
    && mkdir -p /app/media /app/staticfiles \
    && chown -R socialhub:socialhub /app

COPY --chown=socialhub:socialhub . /app

USER socialhub
EXPOSE 8000

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
