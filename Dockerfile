FROM node:22-slim AS deps
WORKDIR /app

# Native build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.0
ENV HUSKY=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/desktop/package.json apps/desktop/
COPY apps/desktop/scripts/ apps/desktop/scripts/
COPY apps/web-server/package.json apps/web-server/

RUN pnpm install --frozen-lockfile

# Build renderer (frontend)
FROM deps AS frontend-build
COPY . .
# electron-vite build builds main + preload + renderer, we only need renderer
# electron-builder is separate (packaging), we skip it
RUN pnpm --filter @open-codesign/desktop exec electron-vite build --config electron.vite.config.ts

# Build web server
FROM deps AS server-build
COPY . .
RUN pnpm --filter @open-codesign/web-server build

# Runtime
FROM node:22-slim AS runtime
WORKDIR /app

RUN npm install -g pnpm@9.15.0 @openai/codex @github/copilot
RUN cd /tmp && npm install figma-mcp supergateway
ENV HUSKY=0

# Copy workspace layout plus installed modules from the build stage. This
# preserves the better-sqlite3 native binding and avoids re-running prepare
# hooks during runtime image assembly.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/web-server/package.json apps/web-server/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web-server/node_modules ./apps/web-server/node_modules

# Copy built artifacts
COPY --from=server-build /app/apps/web-server/dist ./apps/web-server/dist
COPY --from=frontend-build /app/apps/desktop/out/renderer ./apps/desktop/out/renderer

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/web-server/dist/index.js"]
