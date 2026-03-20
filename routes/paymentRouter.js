import express from "express";
import {
  getToken,
  handlePayment,
  verifyPayment,
} from "../controllers/paymentController.js";
import { createOrder } from "../controllers/orderController.js";

const router = express.Router();

//Routes
router.post("/eps/get-token", getToken);
router.post("/eps/initialize-payment", handlePayment);
router.get("/eps/confirm-order", verifyPayment, createOrder);

export default router;
