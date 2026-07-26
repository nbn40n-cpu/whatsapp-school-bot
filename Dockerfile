FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
CMD ["node", "wwjs-bot.js"]
