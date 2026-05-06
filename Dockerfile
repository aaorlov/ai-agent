# syntax=docker/dockerfile:1.7

# Shared base: install all dependencies once. Both `dev` and `build` reuse
# this layer so the lockfile only needs to be re-resolved when it changes.
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- dev ---------------------------------------------------------------
# Hot-reload server. Source is typically bind-mounted by docker compose,
# but the COPY here keeps the image runnable on its own (e.g. `docker run`).
FROM deps AS dev
COPY . .
ENV NODE_ENV=development
EXPOSE 8000
CMD ["bun", "run", "dev"]

# ---- build -------------------------------------------------------------
# Produces a self-contained bundle at ./dist via `bun build --target bun`.
FROM deps AS build
COPY . .
RUN bun run build

# ---- prod --------------------------------------------------------------
# Minimal runtime image: only the bundled artifact, no source, no dev deps.
FROM oven/bun:1-slim AS prod
WORKDIR /app
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
ENV ENV=prod
EXPOSE 8000
CMD ["bun", "run", "./dist/index.js"]
