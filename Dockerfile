FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig*.json ./
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS managed
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --uid 10001 --user-group --create-home --home-dir /home/schema-guard --shell /usr/sbin/nologin schema-guard
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
RUN mkdir -p /data && chown -R schema-guard:schema-guard /data /app
USER schema-guard
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8788/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/managed/dist/server.js"]

FROM node:22-bookworm-slim AS anchor-receiver
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --uid 10002 --user-group --create-home --home-dir /home/schema-guard-anchor --shell /usr/sbin/nologin schema-guard-anchor
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/anchor-receiver ./packages/anchor-receiver
RUN mkdir -p /anchor-data && chown -R schema-guard-anchor:schema-guard-anchor /anchor-data /app
USER schema-guard-anchor
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8790/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/anchor-receiver/dist/server.js"]
