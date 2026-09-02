import express from "express";
import {
  analytics,
  getDashboardStats,
  getRecentOrders,
  getRecentProjects,
} from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/analytics", analytics);
router.get("/stats", getDashboardStats);
router.get("/recent-orders", getRecentOrders);
router.get("/recent-projects", getRecentProjects);

export default router;
