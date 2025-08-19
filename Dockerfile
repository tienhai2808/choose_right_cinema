FROM ghcr.io/puppeteer/puppeteer:24.6.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 2808

CMD ["npm", "start"]