import express from "express";
import {
  deleteOrder,
  getAllOrders,
  getOrder,
  updateOrderStatus,
} from "../controllers/orderController.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
import { verifyId } from "../middleware/verifyId.js";

const router = express.Router();

//Routes
router.get("/getAllOrders", verifyId, verifyAdmin, getAllOrders);
router.get("/getOrder/:orderId", getOrder);
router.put("/updateOrder/:orderId", updateOrderStatus);
router.delete("/deleteOrder/:orderId", deleteOrder);

export default router;
