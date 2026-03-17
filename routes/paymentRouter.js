import express from "express";
import { getToken, handlePayment } from "../controllers/paymentController.js";

const router = express.Router();

//Routes
router.post("/eps/get-token", getToken);
router.post("/eps/initialize-payment", handlePayment);

export default router;
