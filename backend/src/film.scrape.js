const puppeteer = require("puppeteer");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const redis = require("redis");

const Film = require("./models/film.model");
const Cinema = require("./models/cinema.model");
const { getNextSixDays } = require("./utils/scrape.util");
const Showtime = require("./models/showtime.model");
const ShowtimeDetails = require("./models/showtimeDetails.model");

dotenv.config();

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Kết nối MongoDB thành công!"))
  .catch((err) => console.error("Lỗi kết nối MongoDB:", err));

const redisClient = redis.createClient({
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

  const showtimeKeys = await redisClient.keys("showtime:*");
  if (showtimeKeys.length > 0) {
    await redisClient.del(showtimeKeys);
    console.log(`Đã xóa ${showtimeKeys.length} key showtime:* trong Redis`);
  } else {
    console.log("Không có key showtime:* nào trong Redis");
  }

  const showtimeDetailsKeys = await redisClient.keys("showtime-details:*");
  if (showtimeDetailsKeys.length > 0) {
    await redisClient.del(showtimeDetailsKeys);
    console.log(
      `Đã xóa ${showtimeDetailsKeys.length} key showtime-details:* trong Redis`
    );
  } else {
    console.log("Không có key showtime-details:* nào trong Redis");
  }

  const today = getNextSixDays()[0];

  await ShowtimeDetails.deleteMany({
    showtime: {
      $in: await Showtime.find({ date: { $lt: today } }).distinct("_id"),
    },
  });
  console.log("Đã xóa các dữ liệu showtime details thừa trong DB");

  await Showtime.deleteMany({ date: { $lt: today } });
  console.log("Đã xóa các dữ liệu showtime thừa trong DB");

  console.log("Đang đồng bộ dữ liệu từ MongoDB vào Redis...");
  const filmsInDB = await Film.find({});
  const showtimesInDB = await Showtime.find({ date: { $gte: today } }).populate(
    [
      {
        path: "film",
        select: "slug",
      },
      {
        path: "cinema",
        select: "slug",
      },
    ]
  );
  const showtimeIds = showtimesInDB.map((st) => st._id);
  const showtimeDetailsInDB = await ShowtimeDetails.find({
    showtime: { $in: showtimeIds },
  }).populate({
    path: "showtime",
    populate: [
      { path: "film", select: "slug title" },
      { path: "cinema", select: "slug name" },
    ],
  });

  const pipeline = redisClient.multi();
  for (const film of filmsInDB) {
    const redisKey = `film:${film.slug}`;
    const filmData = JSON.stringify({
      id: film._id.toString(),
      title: film.title,
      slug: film.slug,
    });
    pipeline.setEx(redisKey, 86400, filmData);
  }
  for (const showtime of showtimesInDB) {
    const redisKey = `showtime:${showtime.date.toISOString().split("T")[0]}_${
      showtime.film.slug
    }_${showtime.cinema.slug}`;
    pipeline.setEx(redisKey, 86400, showtime._id.toString());
  }
  for (const std of showtimeDetailsInDB) {
    if (!std.showtime) {
      console.log(
        `Bỏ qua showtime detail ${std._id} do không có showtime cha.`
      );
      continue;
    }

    const redisKey = `showtime-details:${
      std.showtime.date.toISOString().split("T")[0]
    }_${std.time}_${std.showtime.film.slug}_${std.showtime.cinema.slug}`;
    const showtimeDetailsData = JSON.stringify({
      id: std._id.toString(),
      price: std.price,
      orderLink: std.orderLink,
    });
    pipeline.setEx(redisKey, 86400, showtimeDetailsData);
  }
  await pipeline.exec();
  console.log(
    `Đã load ${filmsInDB.length} phim, ${showtimesInDB.length} showtime và ${showtimeDetailsInDB.length} chi tiết showtime từ MongoDB vào Redis`
  );
})();

const scrapeData = async () => {
  const cinemas = await Cinema.find({ city: "Đà Nẵng" });

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ["--start-maximized"],
  });
  const page = await browser.newPage();

  try {
    for (const cinema of cinemas) {
      const url = `https://moveek.com/rap/${cinema.slug}/`;

      await page.goto(url, { waitUntil: "networkidle2" });
      const dateList = getNextSixDays();
      for (const date of dateList) {
        const dateSelector = `a[data-date="${date}"]`;
        const dateElement = await page.$(dateSelector);
        if (!dateElement) {
          console.log(
            `Không tìm thấy lịch chiếu ngày ${viewDate} tại rạp ${cinema.name}`
          );
          continue;
        }

        await dateElement.click();
        console.log(`Đã click vào ngày ${date}`);

        await new Promise((r) => setTimeout(r, 1000));

        const filmsWithDetails = await page.$$eval(
          "div[data-movie-id]",
          (els) => {
            const extractDurations = (str) => {
              if (!str) return null;
              const match = str.match(/(\d+)h(\d+)'?/);
              if (!match) return null;
              const hours = parseInt(match[1], 10);
              const minutes = parseInt(match[2], 10);
              return hours * 60 + minutes;
            };

            return els.map((el) => {
              const aTitleFilm = el.querySelector("h4.card-title.mb-1.name a");
              const description = el
                .querySelector("p.card-text.small.text-muted.mb-0")
                ?.textContent.trim();

              const filmInfo = {
                title: aTitleFilm?.textContent.trim(),
                slug: aTitleFilm?.getAttribute("href").split("/")[2],
                image: el.querySelector(".rounded.img-fluid")?.src,
                duration: extractDurations(description),
              };

              const showtimeDetails = [];
              const formatGroups = el.querySelectorAll(".mt-2 .mb-1");

              formatGroups.forEach((group) => {
                const showtimeButtons =
                  group.querySelectorAll("a.btn-showtime");

                showtimeButtons.forEach((btn) => {
                  const time = btn
                    .querySelector("span.time")
                    ?.textContent.trim();
                  const price =
                    btn
                      .querySelector("span.amenity.price")
                      ?.textContent.trim() || null;
                  const orderLink = btn.getAttribute("href");

                  if (time && orderLink) {
                    showtimeDetails.push({
                      time,
                      price,
                      orderLink,
                    });
                  }
                });
              });
              return { filmInfo, showtimeDetails };
            });
          }
        );

        for (const scrapedData of filmsWithDetails) {
          const film = scrapedData.filmInfo;

          if (!film.title || !film.slug || !film.image || !film.duration) {
            console.log(`Dữ liệu phim không đầy đủ, bỏ qua: ${film.title}`);
            continue;
          }

          const redisFilmKey = `film:${film.slug}`;
          const cachedFilm = await redisClient.get(redisFilmKey);
          let existingFilm;

          if (cachedFilm) {
            existingFilm = JSON.parse(cachedFilm);
            console.log(`Phim ${film.title} lấy từ Redis`);
          } else {
            existingFilm = await Film.findOne({ slug: film.slug });
            if (!existingFilm) {
              const newFilm = new Film({
                title: film.title,
                slug: film.slug,
                image: film.image,
                duration: film.duration,
              });
              existingFilm = await newFilm.save();
              console.log(`Đã thêm mới phim ${film.title}`);
            } else {
              console.log(
                `Phim ${film.title} chưa có trong Redis nhưng có trong DB`
              );
            }
            const filmData = JSON.stringify({
              id: existingFilm._id.toString(),
              title: existingFilm.title,
              slug: existingFilm.slug,
            });
            await redisClient.setEx(redisFilmKey, 86400, filmData);
            console.log(`Đã cập nhật phim ${film.title} vào Redis`);
          }

          const redisShowtimeKey = `showtime:${date}_${existingFilm.slug}_${cinema.slug}`;
          const cachedShowtime = await redisClient.get(redisShowtimeKey);

          if (cachedShowtime) {
            console.log(
              `Showtime đã tồn tại trong redis, bỏ qua ngày ${date} phim ${existingFilm.title} rạp ${cinema.name}`
            );
            continue;
          }

          let showtimeDoc = await Showtime.findOne({
            film: existingFilm.id,
            cinema: cinema.id,
            date,
          });

          if (!showtimeDoc) {
            const newShowtime = new Showtime({
              film: existingFilm.id,
              cinema: cinema.id,
              date,
            });
            showtimeDoc = await newShowtime.save();
            console.log(
              `Đã lưu showtime mới: ngày ${date} phim ${existingFilm.title} rạp ${cinema.name}`
            );
          } else {
            console.log(
              `Showtime ngày ${date} phim ${existingFilm.title} rạp ${cinema.name} chưa có trong redis nhưng có trong DB`
            );
          }

          await redisClient.setEx(redisShowtimeKey, 86400, "true");
          console.log(
            `Đã cập nhật showtime (parent) ngày ${date} phim ${existingFilm.title} rạp ${cinema.name} vào Redis`
          );

          if (scrapedData.showtimeDetails.length === 0) {
            console.log(
              `Không tìm thấy chi tiết suất chiếu nào cho phim ${film.title}`
            );
            continue;
          }

          for (const detail of scrapedData.showtimeDetails) {
            const redisDetailKey = `showtime-details:${date}_${detail.time}_${existingFilm.slug}_${cinema.slug}`;
            const cachedDetail = await redisClient.get(redisDetailKey);

            if (cachedDetail) {
              console.log(
                `Chi tiết showtime ${film.title} lúc ${detail.time} đã có trong Redis, bỏ qua.`
              );
              continue;
            }

            let existingDetail = await ShowtimeDetails.findOne({
              showtime: showtimeDoc._id,
              time: detail.time,
            });

            if (!existingDetail) {
              const newDetail = new ShowtimeDetails({
                showtime: showtimeDoc._id,
                time: detail.time,
                price: detail.price,
                orderLink: detail.orderLink,
              });
              existingDetail = await newDetail.save();
              console.log(
                `Đã lưu chi tiết showtime mới: ${film.title} lúc ${detail.time} - ${detail.price}`
              );
            } else {
              console.log(
                `Chi tiết showtime ${film.title} lúc ${detail.time} đã có trong DB, chuẩn bị cache.`
              );
            }

            const showtimeDetailsData = JSON.stringify({
              id: existingDetail._id.toString(),
              price: existingDetail.price,
              orderLink: existingDetail.orderLink,
            });
            await redisClient.setEx(redisDetailKey, 86400, showtimeDetailsData);
            console.log(
              `Đã cache chi tiết showtime ${film.title} lúc ${detail.time} - ${detail.price}`
            );
          }
        }
      }
    }
  } catch (err) {
    console.error(`Lỗi khi scrape ${err}`);
  } finally {
    await browser.close();
    await redisClient.quit();
    await mongoose.connection.close();
  }
};

scrapeData();
