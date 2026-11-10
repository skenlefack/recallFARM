# syntax=docker/dockerfile:1.7
# RecallFarm web (public site + admin + studio). Build context = repository root:
#   docker build -f apps/web/Dockerfile .
# The API is NOT served here: the gateway proxies /v1 to the api service and everything else to web:8080.

FROM node:22-alpine AS build
WORKDIR /app/apps/web
ENV CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/web/ ./
# Public URL used in canonical / Open Graph tags. Mock mode is always off in images.
ARG VITE_PUBLIC_URL=https://recallfarm.app
ENV VITE_PUBLIC_URL=${VITE_PUBLIC_URL} VITE_MOCK=0
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# non-root (uid 101), listens on 8080
COPY --chown=101:101 apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
