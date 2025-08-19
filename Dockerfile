FROM ghcr.io/puppeteer/puppeteer:24.6.0

USER root

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 2808

CMD ["npm", "start"]