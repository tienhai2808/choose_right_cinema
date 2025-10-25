FROM node:20

USER root

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 2808

CMD ["npm", "start"]