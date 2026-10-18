FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine AS api
WORKDIR /app
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/database ./database
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "dist-server/index.cjs"]

FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
