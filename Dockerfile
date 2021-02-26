FROM node:12.20.0-alpine AS builder

WORKDIR /app

COPY . .

RUN npm install
RUN npm run build

FROM node:12.20.0-alpine AS development

WORKDIR /app

COPY --from=builder /app/out .

RUN npm install

EXPOSE 12776 12777

CMD ["node", "server.js"]