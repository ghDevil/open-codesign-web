FROM node:22-slim AS deps
WORKDIR /app

# Native build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/desktop/package.json apps/desktop/
COPY apps/web-server/package.json apps/web-server/

RUN pnpm install --frozen-lockfile

# ── Build renderer (frontend) ──────────────────────────────────────────────────
FROM deps AS frontend-build
COPY . .
# electron-vite build builds main + preload + renderer, we only need renderer
# electron-builder is separate (packaging), we skip it
RUN pnpm --filter @open-codesign/desktop exec electron-vite build --config electron.vite.config.ts

# ── Build web server ───────────────────────────────────────────────────────────
FROM deps AS server-build
COPY . .
RUN pnpm --filter @open-codesign/web-server build

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

RUN npm install -g pnpm@9.15.0

# Copy pnpm workspace layout (needed for workspace package resolution at runtime)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/web-server/package.json apps/web-server/

# Install production deps only (no devDeps)
RUN pnpm install --prod --frozen-lockfile --filter @open-codesign/web-server

# Copy built artifacts
COPY --from=server-build /app/apps/web-server/dist ./apps/web-server/dist
COPY --from=frontend-build /app/apps/desktop/out/renderer ./apps/desktop/out/renderer

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/web-server/dist/index.js"]
