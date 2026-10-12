# ---- build the web app ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npx vite build

# ---- tiny runtime: Node + zero-dependency server ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/index.js"]
