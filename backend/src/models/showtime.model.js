const mongoose = require("mongoose");

const showtimeSchema = new mongoose.Schema(
  {
    cinema: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cinema",
      required: true,
    },
    film: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Film",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
  },
  { timestamps: false }
);

const Showtime = mongoose.model("Showtime", showtimeSchema);

module.exports = Showtime;
