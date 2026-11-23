FROM node:24.20.0-bookworm-slim

WORKDIR /app

ARG SOCIALHUB_FRONTEND_INSTALL_DEPS=true

COPY package.json package-lock.json ./
RUN if [ "$SOCIALHUB_FRONTEND_INSTALL_DEPS" = "true" ]; then \
      npm ci --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000; \
    else \
      echo "Skipping npm ci because frontend dependencies are supplied separately."; \
    fi
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
