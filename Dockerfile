FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install && npm cache clean --force
COPY . .

CMD ["node", "baileys-bot.js"]
