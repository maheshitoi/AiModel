# NestJS backend. Build from the repo root:  docker build -f docker/backend.Dockerfile .
# The "build" stage (with the Prisma CLI) also runs the database migrations: see docker-compose.prod.yml.

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspace apps/backend --include-workspace-root
COPY prisma prisma
COPY apps/backend apps/backend
RUN npx prisma generate --schema prisma/schema.prisma && npm run build --workspace apps/backend

FROM build AS prod-deps
# Drop dev dependencies; the generated Prisma client (node_modules/.prisma) stays.
RUN npm prune --omit=dev --workspace apps/backend --include-workspace-root && mkdir -p apps/backend/node_modules

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/backend/node_modules apps/backend/node_modules
COPY --from=build /app/apps/backend/package.json apps/backend/
COPY --from=build /app/apps/backend/dist apps/backend/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/dist/main.js"]
