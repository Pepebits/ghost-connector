# Ghost Connector: web panel (and CLI) in a container.
# Config and data live in the /data volume: /data/config.env and /data/data.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
# DATA_DIR is fixed here (it wins over config.env): a DATA_DIR copied from a
# repo .env (".runs", ".data") would point inside the image, not the volume.
ENV NODE_ENV=production \
    GHOST_CONNECTOR_HOME=/data \
    DATA_DIR=/data/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY .env.example ./
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# `ghost-connector <command>` inside the container, as on the host (docker compose exec ghost-connector ghost-connector backup).
RUN ln -s /usr/local/bin/docker-entrypoint.sh /usr/local/bin/ghost-connector && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4300/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
# 0.0.0.0 inside the container; the compose file only publishes it on the host's 127.0.0.1.
CMD ["serve", "--host", "0.0.0.0", "--port", "4300"]
