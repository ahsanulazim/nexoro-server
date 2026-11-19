import { Router } from "express";
import {
  acceptWhatsAppCall,
  getWhatsAppCallingSettings,
  getWhatsAppConversations,
  handleWhatsAppWebhook,
  initiateWhatsAppCall,
  rejectWhatsAppCall,
  sendWhatsAppMessage,
  terminateWhatsAppCall,
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

// Official Meta WhatsApp Calling Endpoints
whatsappRouter.get("/calls/settings", verifyId, getWhatsAppCallingSettings);
whatsappRouter.post("/calls/initiate", verifyId, initiateWhatsAppCall);
whatsappRouter.post("/calls/:callId/accept", verifyId, acceptWhatsAppCall);
whatsappRouter.post("/calls/:callId/reject", verifyId, rejectWhatsAppCall);
whatsappRouter.post("/calls/:callId/terminate", verifyId, terminateWhatsAppCall);

export default whatsappRouter;
