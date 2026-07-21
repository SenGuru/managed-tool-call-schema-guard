FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY tsconfig*.json ./
RUN npm ci
RUN npm run build -- --force
RUN npm prune --omit=dev
RUN mkdir -p /runtime-data /runtime-anchor-data

FROM gcr.io/distroless/nodejs22-debian13@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50 AS runtime

FROM runtime AS managed
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --chown=65532:65532 --from=build /runtime-data /data
USER 65532:65532
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8788/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["packages/managed/dist/server.js"]

FROM runtime AS anchor-receiver
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/anchor-receiver ./packages/anchor-receiver
COPY --chown=65532:65532 --from=build /runtime-anchor-data /anchor-data
USER 65532:65532
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8790/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["packages/anchor-receiver/dist/server.js"]
