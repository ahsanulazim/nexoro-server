import { Router } from "express";
import { verifyFBWebhook } from "../controllers/facebookController.js";

const facebookRouter = Router();

facebookRouter.get("/webhook", verifyFBWebhook);

export default facebookRouter;
