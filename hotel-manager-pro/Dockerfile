# Hotel Manager Pro — images de production (API et interface), construites depuis la racine du dépôt.
#   docker build --target api -t hmp-api .
#   docker build --target web -t hmp-web .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Dépendances : couche mise en cache tant que les manifestes ne changent pas
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# Interface : construite puis servie par nginx (même origine que l'API grâce au proxy /api)
FROM deps AS web-build
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @hmp/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

# API + migrations + tâche de cycle de vie : même image, commandes différentes
FROM deps AS api
COPY packages packages
COPY apps/api apps/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@hmp/api", "start"]
