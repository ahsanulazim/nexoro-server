import { Router } from "express";
import {
  getMessages,
  getSidebarConversations,
  sendMessage,
} from "../controllers/messageController.js";
import { verifyId } from "../middleware/verifyId.js";

const messageRouter = Router();

//Routes
messageRouter.post("/sendMessage", verifyId, sendMessage);
messageRouter.get("/getMessages", verifyId, getMessages);
messageRouter.get(
  "/getSidebarConversations",
  verifyId,
  getSidebarConversations,
);

export default messageRouter;
