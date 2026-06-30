FROM docker.io/library/node:24-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development

ENV NODE_ENV=development

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "run", "dev"]

FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM docker.io/library/node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 10001 skycustoms \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin skycustoms

COPY --from=build --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist

USER 10001:10001

CMD ["node", "dist/index.js"]
