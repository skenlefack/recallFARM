# RecallFarm API — build context = repository root (see infra docker-compose):
#   docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache tzdata tini
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Africa/Douala \
    PACKS_DIR=/app/packages/params/packs \
    VECTORS_DIR=/app/packages/params/vectors \
    KEYS_DIR=/app/keys \
    EXPORTS_DIR=/app/var/exports
WORKDIR /app
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json
COPY packages/params/packs ./packages/params/packs
COPY packages/params/vectors ./packages/params/vectors
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/keys /app/var/exports \
 && chown -R node:node /app/keys /app/var
USER node
EXPOSE 3000
VOLUME ["/app/keys", "/app/var"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/v1/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
