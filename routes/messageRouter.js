import { Router } from "express";
import { sentMessage } from "../controllers/messageController.js";
import upload from "../middleware/uploadCloudinary.js";

const messageRouter = Router();

//Routes

messageRouter.post("/sendMassage", upload.single("image"), sentMessage);
