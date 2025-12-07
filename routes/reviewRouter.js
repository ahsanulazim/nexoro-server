import express from "express";
import { createReview } from "../controllers/reviewController.js";

const router = express.Router();

//Routes
router.post("/", createReview);

export default router;