import express from "express";
import { createReview, deleteReviews, getAllReviews, updateReview } from "../controllers/reviewController.js";

const router = express.Router();

//Routes
router.post("/", createReview);
router.get("/", getAllReviews);
router.delete("/:id", deleteReviews);
router.put("/:id", updateReview);

export default router;