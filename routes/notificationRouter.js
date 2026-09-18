import { Router } from "express";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController.js";
import { verifyId } from "../middleware/verifyId.js";

const notificationRouter = Router();

// Protect all routes with verifyId middleware
notificationRouter.use(verifyId);

notificationRouter.get("/", getNotifications);
notificationRouter.patch("/mark-all-read", markAllAsRead);
notificationRouter.patch("/:id/read", markAsRead);

export default notificationRouter;
