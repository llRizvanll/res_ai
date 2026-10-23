# Restaurant POS — production image. Data lives in the /data volume; mount it so it survives updates.
# Build:  docker build -t restaurant-pos .
# Run:    docker compose up -d        (see docker-compose.yml and DEPLOYMENT.md)

# ---- build: compile TypeScript (server → dist/, browser → public/js/)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.server.json tsconfig.client.json ./
RUN npm ci
COPY src ./src
COPY public ./public
RUN npm run build

# ---- runtime: only what the server needs
FROM node:22-alpine
# tzdata makes TZ work: daily reports and the closing-time backup follow the restaurant's local time
RUN apk add --no-cache tzdata su-exec && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TZ=Asia/Kolkata
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/shared ./dist/shared
COPY --from=build /app/public ./public
COPY deploy/docker-entrypoint.sh /usr/local/bin/pos-entrypoint
# Starts as root only to fix /data ownership, then runs the app as `node`
ENTRYPOINT ["pos-entrypoint"]
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
# SIGTERM lets the server take a final backup and flush the database before stopping
STOPSIGNAL SIGTERM
CMD ["node", "--no-warnings", "dist/server/supervisor.js"]
