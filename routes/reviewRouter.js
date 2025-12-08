import express from "express";
import { createReview } from "../controllers/reviewController.js";
import upload from "../middleware/uploadCloudinary.js";

const router = express.Router();

//Routes
router.post("/", upload.none(), createReview);

export default router;