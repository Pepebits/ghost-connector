#!/bin/sh
# /data is a bind mount: if Docker created it (as root), the "node" user
# can't write there. Say so clearly instead of failing later with EACCES.
if ! touch /data/.write-test 2>/dev/null; then
  echo "ghost-connector: /data is not writable by uid $(id -u)." >&2
  echo "On the host, run: sudo chown -R $(id -u):$(id -g) ghost-data" >&2
  exit 1
fi
rm -f /data/.write-test
exec node /app/dist/index.js "$@"
