import express from "express";
import { createBlog, getAllBlogs } from "../controllers/blogController.js";
import upload from "../middleware/uploadCloudinary.js";

const router = express.Router();

router.post("/", upload.single("image"), createBlog);
router.get("/allBlogs", getAllBlogs);

export default router;