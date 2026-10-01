# Production image: Next.js standalone server + migrations on start-up.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build imports the DB module, which only needs a URL to exist; no connection is made.
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build:build@localhost:5432/build
RUN mkdir -p public && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /data/uploads && chown app:app /data/uploads
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/migrate.mjs ./scripts/migrate.mjs
# The migrator isn't part of the traced server bundle, so ship the full packages.
COPY --from=build --chown=app:app /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=app:app /app/node_modules/postgres ./node_modules/postgres
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
