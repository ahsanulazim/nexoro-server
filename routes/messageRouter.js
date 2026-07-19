import { Router } from "express";
import {
  getMessages,
  getSidebarConversations,
  sendMessage,
  deleteConversation,
} from "../controllers/messageController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
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
messageRouter.delete("/deleteConversation", verifyAdmin, deleteConversation);

export default messageRouter;
