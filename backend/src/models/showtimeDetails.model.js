const mongoose = require("mongoose");

const showtimeDetailsSchema = new mongoose.Schema(
  {
    showtime: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Showtime",
      required: true,
    },
    time: {
      type: String,
      required: true,
    },
    price: {
      type: String,
      required: false,
    },
    orderLink: {
      type: String,
      required: false,
    },
  },
  { timestamps: false }
);

const ShowtimeDetails = mongoose.model(
  "ShowtimeDetails",
  showtimeDetailsSchema
);

module.exports = ShowtimeDetails;
