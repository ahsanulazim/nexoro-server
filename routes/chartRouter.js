import express from "express";
import { revenueChart } from "../controllers/chartController.js";

const router = express.Router();

router.get("/revenueChart", revenueChart);

export default router;
