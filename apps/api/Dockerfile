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
# Correctifs Alpine publies apres l'image de base, puis retrait des gestionnaires de paquets livres
# avec l'image node (npm, npx, corepack, yarn) : inutiles a l'execution (entrypoint et CMD n'appellent
# que node) et porteurs de CVE HIGH (Trivy : brace-expansion, ip-address, pacote, picomatch, sigstore
# dans /usr/local/lib/node_modules/npm). Voir docs/security/cve-image-api.md.
RUN apk upgrade --no-cache \
 && apk add --no-cache tzdata tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
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
