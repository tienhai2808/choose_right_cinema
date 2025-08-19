import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:2808/api",
});

export default api;
