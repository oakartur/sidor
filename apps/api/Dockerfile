FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run prisma:generate
RUN npm run build --workspace @sidor/domain
RUN npm run build --workspace @sidor/api

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/domain/package.json packages/domain/package.json
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
