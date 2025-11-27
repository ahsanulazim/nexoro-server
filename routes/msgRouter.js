import express from "express";
import { createMessage, getAllMessages, getMessage, msgRead } from "../controllers/msgController.js";

const router = express.Router();

//routes
router.post("/", createMessage);
router.get("/", getAllMessages);
router.get("/:message", getMessage);
router.patch("/:message", msgRead);

export default router;