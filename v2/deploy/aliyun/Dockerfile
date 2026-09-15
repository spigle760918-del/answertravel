FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.production.json ./
COPY web ./web
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm ci --ignore-scripts --no-fund --no-audit \
  && node scripts/check-runtime.mjs --strict \
  && npm run build:web \
  && npm run build:server

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
COPY --from=build /app/migrations ./migrations
USER node
EXPOSE 4288
CMD ["node", "dist/src/main.js"]
