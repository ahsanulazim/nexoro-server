import axios from "axios";
import { config } from "dotenv";
config();

export const fbApi = axios.create({
  baseURL: "https://graph.facebook.com/v25.0/",
  params: {
    access_token: process.env.FB_ACCESS_TOKEN,
  },
});
