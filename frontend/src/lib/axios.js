import axios from "axios";

const BASE_URL =
  process.env.NODE_ENV === "development"
    ? process.env.REACT_APP_API_URL
    : "/api";
const api = axios.create({
  baseURL: BASE_URL,
});

export default api;
