import { Router } from "express";
import {
  getMessages,
  getSidebarConversations,
  sendMessage,
} from "../controllers/messageController.js";
import { verifyId } from "../middleware/verifyId.js";
import upload from "../middleware/uploadCloudinary.js";

const messageRouter = Router();

//Routes
messageRouter.post(
  "/sendMessage",
  verifyId,
  upload.single("file"),
  sendMessage,
);
messageRouter.get("/getMessages", verifyId, getMessages);
messageRouter.get(
  "/getSidebarConversations",
  verifyId,
  getSidebarConversations,
);

export default messageRouter;
