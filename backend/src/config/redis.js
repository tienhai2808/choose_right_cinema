const { createClient } = require("redis");
const dotenv = require("dotenv");
dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

(async () => {
  redisClient.on("error", (err) => {
    console.log("Redis client error", err);
  });

  redisClient.on("ready", () => {
    console.log("Redis client started");
  });

  await redisClient.connect();
  await redisClient.ping();
})();

module.exports = redisClient;
