const Film = require("../models/film.model");
const Cinema = require("../models/cinema.model");
const Showtime = require("../models/showtime.model");
const ShowtimeDetails = require("../models/showtimeDetails.model");
const {
  calculateDistances,
  getGeminiRecommendation,
} = require("../utils/choose.util");

module.exports.chooseRightCinema = async (req, res) => {
  try {
    const { filmName, viewDate, location, radius, limit } = req.body;
    if (!filmName || !location || !radius) {
      return res
        .status(400)
        .json({ message: "Thiếu thông tin: filmName, location hoặc radius" });
    }
    if (!location.lat || !location.lng) {
      return res.status(400).json({ message: "Location phải có lat và lng" });
    }
    if (typeof radius !== "number" || radius <= 0) {
      return res.status(400).json({ message: "Radius phải là số dương" });
    }

    const filmQuery = {
      title: { $regex: new RegExp(filmName, "i") },
    };
    const film = await Film.findOne(filmQuery).lean();

    if (!film) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy phim khớp với tên" });
    }

    const queryDate = new Date(viewDate);
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const cinemasInRadius = await Cinema.find({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [location.lng, location.lat],
          },
          $maxDistance: radius * 1000,
        },
      },
    }).lean();
    if (!cinemasInRadius.length) {
      return res.status(404).json({
        message: "Không tìm thấy rạp nào trong bán kính yêu cầu",
      });
    }

    const cinemaIds = cinemasInRadius.map((c) => c._id);
    const showtimes = await Showtime.find({
      film: film._id,
      cinema: { $in: cinemaIds },
      date: {
        $gte: queryDate,
        $lt: nextDay,
      },
    }).lean();

    if (!showtimes.length) {
      return res.status(404).json({
        message: "Không tìm thấy xuất chiếu nào cho phim này vào ngày yêu cầu",
      });
    }

    const showtimeIds = showtimes.map((st) => st._id);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const isQueryingToday = queryDate.getTime() === today.getTime();

    const detailsQuery = {
      showtime: { $in: showtimeIds },
    };

    if (isQueryingToday) {
      const currentTimeString =
        ("0" + now.getHours()).slice(-2) +
        ":" +
        ("0" + now.getMinutes()).slice(-2);
      detailsQuery.time = { $gte: currentTimeString };
    }

    const allShowtimeDetails = await ShowtimeDetails.find(detailsQuery)
      .select("showtime time price orderLink")
      .lean();

    const showtimeDetailsMap = {};
    allShowtimeDetails.forEach((detail) => {
      const key = detail.showtime.toString();
      if (!showtimeDetailsMap[key]) {
        showtimeDetailsMap[key] = [];
      }
      showtimeDetailsMap[key].push({
        time: detail.time,
        price: detail.price || null,
        orderLink: detail.orderLink || null,
      });
    });

    const showtimeMap = {};
    showtimes.forEach((st) => {
      const cinemaId = st.cinema.toString();
      const showtimeId = st._id.toString();
      if (!showtimeMap[cinemaId]) showtimeMap[cinemaId] = [];
      showtimeMap[cinemaId].push(...(showtimeDetailsMap[showtimeId] || []));
    });

    const cinemasWithShowtimes = cinemasInRadius
      .filter(
        (cinema) =>
          showtimeMap[cinema._id.toString()] &&
          showtimeMap[cinema._id.toString()].length > 0
      )
      .map((cinema) => ({
        cinema,
        showtimeDetails: showtimeMap[cinema._id.toString()],
      }));

    if (!cinemasWithShowtimes.length) {
      return res.status(404).json({
        message: "Không tìm thấy rạp nào chiếu phim này trong bán kính",
      });
    }

    const travelInfos = await calculateDistances(
      cinemasWithShowtimes.map((item) => item.cinema),
      location
    );

    const cinemasWithDistance = cinemasWithShowtimes
      .map((item, index) => ({
        name: item.cinema.name,
        slug: item.cinema.slug,
        address: item.cinema.address,
        distance: travelInfos[index].distance,
        duration: travelInfos[index].duration,
        showtimes: item.showtimeDetails,
      }))
      .sort((a, b) => a.distance - b.distance);

    const limitedResults = cinemasWithDistance.slice(0, limit || 10);

    const geminiResponse = await getGeminiRecommendation(
      limitedResults,
      filmName,
      viewDate
    );

    res.status(200).json({
      message: "Các rạp phù hợp với bạn là:",
      data: limitedResults,
      recommendedCinema: geminiResponse,
    });
  } catch (err) {
    console.log(`Lỗi chọn rạp: ${err.message}`);
    res.status(500).json({ message: "Internal server error" });
  }
};
