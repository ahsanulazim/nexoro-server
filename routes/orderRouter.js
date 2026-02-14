import express from "express";
import { createOrder, getAllOrders } from "../controllers/orderController.js";

const router = express.Router();

//Routes
router.post("/checkout", createOrder);
router.get("/getAllOrders", getAllOrders);

export default router;