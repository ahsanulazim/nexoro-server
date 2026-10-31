import { Router } from "express";
import {
  getConversations,
  handleFBWebhook,
  sendFBMessage,
  verifyFBWebhook,
  syncFacebookConversations,
} from "../controllers/facebookController.js";
import { verifyId } from "../middleware/verifyId.js";

const facebookRouter = Router();

// Meta Webhook Verification & Listener
facebookRouter.get("/webhook", verifyFBWebhook);
facebookRouter.post("/webhook", handleFBWebhook);

// Protected Admin Actions
facebookRouter.get("/conversations", verifyId, getConversations);
facebookRouter.post("/sendMessage", verifyId, sendFBMessage);
facebookRouter.post("/sync", verifyId, syncFacebookConversations);
facebookRouter.get("/sync", verifyId, syncFacebookConversations);

export default facebookRouter;
