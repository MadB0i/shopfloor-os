FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY sql ./sql
COPY web ./web
EXPOSE 8787
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
