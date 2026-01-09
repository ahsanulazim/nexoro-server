import express from "express";
import { createBlog } from "../controllers/blogController.js";
import upload from "../middleware/uploadCloudinary.js";

const router = express.Router();

router.post("/", upload.single("image"), createBlog);

export default router;