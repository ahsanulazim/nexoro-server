import express from "express";
import {
  createBlog,
  deleteABlog,
  getAllBlogs,
  getBlog,
  getLatestBlogs,
  updateBlog,
} from "../controllers/blogController.js";
import upload from "../middleware/uploadCloudinary.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";

const router = express.Router();

router.post("/", upload.single("image"), createBlog);
router.get("/allBlogs", getAllBlogs);
router.get("/latestBlogs", getLatestBlogs);
router.get("/getBlog/:slug", getBlog);
router.delete("/:id", deleteFromCloudinary, deleteABlog);
router.put("/:id", upload.single("image"), updateBlog);

export default router;
