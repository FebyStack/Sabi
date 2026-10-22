# Debian (glibc) throughout: Chrome headless shell, rspack (Remotion's bundler) and sharp ship glibc binaries.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
RUN VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST npm run build && npm run build:server

FROM node:22-bookworm-slim AS api
WORKDIR /app
# ffmpeg probes, extracts audio and muxes the cut fades; the libraries are what Chrome headless shell links against;
# the emoji font draws caption emoji (the bundled OFL fonts cover only text).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
      libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx remotion browser ensure
COPY --from=build /app/dist-server ./dist-server
# Remotion bundles the composition from source at boot; the schema and the demo bundle are read at boot too.
COPY shared ./shared
COPY database ./database
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "dist-server/index.mjs"]

FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
