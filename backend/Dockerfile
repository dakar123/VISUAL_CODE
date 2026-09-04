FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json package-lock.json* ./
RUN npm install --production --silent

COPY . .

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV MONGO_URL=mongodb://datastore:datastore123@mongodb:27017/datastore?authSource=admin

CMD ["node", "server.js"]