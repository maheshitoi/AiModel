# Next.js dashboard (standalone server). Build from the repo root:
#   docker build -f docker/frontend.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://example.com/api/v1 .
# NEXT_PUBLIC_API_URL is compiled into the browser code, so changing it needs a rebuild.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace apps/frontend --include-workspace-root
COPY apps/frontend apps/frontend
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace apps/frontend

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=node /app/apps/frontend/.next/static apps/frontend/.next/static
COPY --from=build --chown=node /app/apps/frontend/public apps/frontend/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/frontend/server.js"]
