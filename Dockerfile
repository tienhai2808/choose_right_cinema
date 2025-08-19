FROM ghcr.io/puppeteer/puppeteer:24.6.0

USER root

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 2808

CMD ["npm", "start"]