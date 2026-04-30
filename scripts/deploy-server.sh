#!/usr/bin/env bash
# Server-side deploy script for build.wickedlab.io
#
# Workflow:
#   1. Pull latest from current branch
#   2. Build web-server bundle and desktop renderer inside a Node container
#   3. Copy built artifacts into the running app container
#   4. Restart the app container
#
# Usage:
#   ./scripts/deploy-server.sh [branch]
#
# Designed to run on the deploy host (deploy@46.225.102.175) from
# ~/open-codesign-web.

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
APP_CONTAINER="app-bokgcsgk0so8ws0wos0cgcc8"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

echo "==> Branch: $BRANCH"
echo "==> Repo:   $REPO_DIR"
echo "==> App:    $APP_CONTAINER"

cd "$REPO_DIR"

echo "==> Pulling latest changes"
git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Building inside node:22 container"
docker run --rm \
  -v "$REPO_DIR:/app" \
  -w /app \
  -e HUSKY=0 \
  --network host \
  node:22-slim \
  bash -c "set -e; \
    apt-get update -qq && apt-get install -y -qq python3 make g++ ca-certificates >/dev/null 2>&1 || true; \
    npm install -g pnpm@9.15.0 --silent; \
    pnpm install --frozen-lockfile --silent; \
    pnpm --filter '@open-codesign/web-server' build; \
    pnpm --filter '@open-codesign/desktop' exec electron-vite build --config electron.vite.config.ts"

echo "==> Copying bundle into container"
docker cp apps/web-server/dist/index.js "$APP_CONTAINER":/app/apps/web-server/dist/index.js

echo "==> Starting container for asset sync"
docker start "$APP_CONTAINER" >/dev/null 2>&1 || true

echo "==> Copying skills into container"
docker exec "$APP_CONTAINER" rm -rf /app/apps/web-server/dist/builtin
docker cp apps/web-server/dist/builtin "$APP_CONTAINER":/app/apps/web-server/dist/builtin

echo "==> Copying renderer into container"
docker exec "$APP_CONTAINER" rm -rf /app/apps/desktop/out/renderer
docker cp apps/desktop/out/renderer "$APP_CONTAINER":/app/apps/desktop/out/renderer

echo "==> Materializing Remotion runtime deps"
docker run --rm \
  -v "$REPO_DIR:/app" \
  -w /app \
  node:22-slim \
  bash -c "rm -rf /app/.runtime-package && mkdir -p /app/.runtime-package && chown -R $HOST_UID:$HOST_GID /app/.runtime-package"
cat > .runtime-package/package.json <<'EOF'
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@remotion/bundler": "4.0.454",
    "@remotion/renderer": "4.0.454",
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "remotion": "4.0.454",
    "zod": "3.24.1"
  }
}
EOF
docker run --rm \
  -v "$REPO_DIR:/app" \
  -w /app/.runtime-package \
  -u "$HOST_UID:$HOST_GID" \
  node:22-slim \
  bash -c "npm install --omit=dev --no-package-lock --silent"
mkdir -p .runtime-package/node_modules/@open-codesign/animation
mkdir -p .runtime-package/node_modules/@open-codesign/shared
cp packages/animation/package.json .runtime-package/node_modules/@open-codesign/animation/package.json
cp -R packages/animation/src .runtime-package/node_modules/@open-codesign/animation/src
cp packages/shared/package.json .runtime-package/node_modules/@open-codesign/shared/package.json
cp -R packages/shared/src .runtime-package/node_modules/@open-codesign/shared/src

echo "==> Copying Remotion runtime deps into container"
docker exec "$APP_CONTAINER" rm -rf /app/runtime/node_modules
docker exec "$APP_CONTAINER" mkdir -p /app/runtime/node_modules
docker cp .runtime-package/node_modules/. "$APP_CONTAINER":/app/runtime/node_modules/

echo "==> Ensuring runtime dependencies"
docker exec -u 0 "$APP_CONTAINER" sh -c \
  "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates chromium >/dev/null 2>&1 || true" || true

echo "==> Restarting container"
docker restart "$APP_CONTAINER"

echo "==> Waiting for healthcheck"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://localhost:3000/healthz >/dev/null 2>&1 || \
     docker exec "$APP_CONTAINER" wget -qO- http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "==> Container healthy"
    exit 0
  fi
  sleep 2
done

echo "==> WARNING: healthcheck did not pass within 20s, but container restarted"
exit 0
