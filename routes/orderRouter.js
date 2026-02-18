import express from "express";
import { createOrder, getAllOrders, getOrder } from "../controllers/orderController.js";

const router = express.Router();

//Routes
router.post("/checkout", createOrder);
router.get("/getAllOrders", getAllOrders);
router.get("/getOrder/:orderId", getOrder);

export default router;