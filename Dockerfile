# Ghost Connector: web panel (and CLI) in a container.
# Config and data live in the /data volume: /data/config.env and /data/data.
#
# Alpine keeps the attack surface small: few OS packages, no npm/corepack in
# the final image (the app never installs anything at runtime), and the OS
# security updates applied at build time.

# Pinned by digest for reproducible builds; Dependabot proposes the updates.
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# DATA_DIR is fixed here (it wins over config.env): a DATA_DIR copied from a
# repo .env (".runs", ".data") would point inside the image, not the volume.
ENV NODE_ENV=production \
    GHOST_CONNECTOR_HOME=/data \
    DATA_DIR=/data/data
WORKDIR /app
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY .env.example ./
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# `ghost-connector <command>` inside the container, as on the host (docker compose exec ghost-connector ghost-connector backup).
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && ln -s /usr/local/bin/docker-entrypoint.sh /usr/local/bin/ghost-connector \
  && mkdir -p /data && chown node:node /data
# The app's code is root-owned and read-only for the "node" user it runs as.
USER node
VOLUME /data
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4300/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
# 0.0.0.0 inside the container; the compose file only publishes it on the host's 127.0.0.1.
CMD ["serve", "--host", "0.0.0.0", "--port", "4300"]
