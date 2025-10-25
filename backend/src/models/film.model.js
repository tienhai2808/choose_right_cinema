const mongoose = require("mongoose");

const filmSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    image: {
      type: String,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
  },
  { timestamps: false }
);

const Film = mongoose.model("Film", filmSchema);

module.exports = Film;
