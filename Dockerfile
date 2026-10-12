FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY db ./db
COPY docs ./docs
COPY logos ./logos
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY --from=build /app/docs ./docs
COPY --from=build /app/logos ./logos

EXPOSE 8080
CMD ["node", "dist/server.js"]
