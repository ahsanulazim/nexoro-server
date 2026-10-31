import express from "express";
import {
  analytics,
  getDashboardStats,
  getPeriodBreakdown,
  getRecentOrders,
  getRecentProjects,
} from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/analytics", analytics);
router.get("/stats", getDashboardStats);
router.get("/period-breakdown", getPeriodBreakdown);
router.get("/recent-orders", getRecentOrders);
router.get("/recent-projects", getRecentProjects);

export default router;
