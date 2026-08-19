FROM node:20-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
  && pip3 install --break-system-packages edge-tts \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install && npm cache clean --force
COPY . .

CMD ["node", "baileys-bot.js"]
