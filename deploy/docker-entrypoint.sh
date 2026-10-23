#!/bin/sh
# Docker creates bind-mounted folders (./data) as root. Hand /data to the unprivileged `node` user,
# then run the app as that user — never as root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec su-exec node "$@"
fi
exec "$@"
