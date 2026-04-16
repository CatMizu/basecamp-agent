FROM node:22-alpine AS builder
WORKDIR /app
# better-sqlite3 ships prebuilds, but node-gyp is still needed when a prebuild
# is missing for the current Node ABI.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
EXPOSE 3232
CMD ["node", "dist/index.js"]
