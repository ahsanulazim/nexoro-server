import { Router } from "express";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";

const notificationRouter = Router();

// Protect all routes with verifyAdmin middleware
notificationRouter.use(verifyAdmin);

notificationRouter.get("/", getNotifications);
notificationRouter.patch("/mark-all-read", markAllAsRead);
notificationRouter.patch("/:id/read", markAsRead);

export default notificationRouter;
