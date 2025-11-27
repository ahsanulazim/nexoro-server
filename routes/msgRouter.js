import express from "express";
import { createMessage, getAllMessages, getMessage } from "../controllers/msgController.js";

const router = express.Router();

//routes
router.post("/", createMessage);
router.get("/", getAllMessages);
router.get("/:message", getMessage);

export default router;