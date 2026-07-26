FROM node:20-slim

WORKDIR /app
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install
COPY . .

CMD ["node", "baileys-bot.js"]
