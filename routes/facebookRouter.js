import { Router } from "express";
import {
  getConversations,
  verifyFBWebhook,
} from "../controllers/facebookController.js";

const facebookRouter = Router();

facebookRouter.get("/webhook", verifyFBWebhook);
facebookRouter.get("/conversations", getConversations);

export default facebookRouter;
