FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002 DATABASE_PATH=/app/data/pocketledger.sqlite
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/healthcheck.mjs
USER node
EXPOSE 3002
VOLUME /app/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["npm", "start"]

