# GP Business Manager — serveur web. Contexte de build : le dossier gp-business-manager/ (racine du monorepo).
#   docker build -f apps/server/Dockerfile -t gp-server .
FROM node:24-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/desktop ./apps/desktop
COPY apps/server ./apps/server
RUN npm ci --no-audit --no-fund
RUN npm run build -w @gp/server

FROM node:24-slim
ENV NODE_ENV=production GP_DATA_DIR=/data GP_PUBLIC_DIR=/app/public PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/server/dist/server.cjs ./server.cjs
COPY --from=build /app/apps/server/dist/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.cjs"]
