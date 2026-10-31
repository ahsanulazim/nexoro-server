import { Router } from "express";
import {
  getWhatsAppConversations,
  handleWhatsAppWebhook,
  sendWhatsAppMessage,
  verifyWhatsAppWebhook,
} from "../controllers/whatsappController.js";
import { verifyId } from "../middleware/verifyId.js";

const whatsappRouter = Router();

// WhatsApp Cloud API Webhook
whatsappRouter.get("/webhook", verifyWhatsAppWebhook);
whatsappRouter.post("/webhook", handleWhatsAppWebhook);

// Protected Admin Actions
whatsappRouter.get("/conversations", verifyId, getWhatsAppConversations);
whatsappRouter.post("/sendMessage", verifyId, sendWhatsAppMessage);

export default whatsappRouter;
