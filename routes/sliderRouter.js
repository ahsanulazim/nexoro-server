import express from "express";
import { createSlider, getAllSliders } from "../controllers/sliderController.js";

const router = express.Router();

router.post("/", createSlider);
router.get("/", getAllSliders);

export default router;