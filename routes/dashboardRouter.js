import express from "express";
import { analytics } from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/analytics", analytics);

export default router;
