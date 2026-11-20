FROM node:24.20.0-bookworm-slim

WORKDIR /app

ENV HUSKY=0

ARG SOCIALHUB_FRONTEND_INSTALL_DEPS=true

COPY . .
RUN if [ "$SOCIALHUB_FRONTEND_INSTALL_DEPS" = "true" ]; then \
      npm ci --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000; \
    else \
      echo "Skipping npm ci because frontend dependencies are supplied separately."; \
    fi

EXPOSE 8000
CMD ["npm", "start", "--", "--host", "0.0.0.0", "--port", "8000"]
