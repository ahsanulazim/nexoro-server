import express from "express";
import {
  createOrder,
  deleteOrder,
  getAllCountries,
  getAllOrders,
  getOrder,
  updateOrderStatus,
} from "../controllers/orderController.js";

import { verifyId } from "../middleware/verifyId.js";
import { verifyAdminOrMember } from "../middleware/verifyAdminOrMember.js";

const router = express.Router();

//Routes
router.post("/createOrder", createOrder);
router.get("/getAllOrders", verifyId, verifyAdminOrMember, getAllOrders);
router.get("/getOrder", getOrder);
router.get("/countries", getAllCountries);
router.put("/updateOrder/:orderId", updateOrderStatus);
router.delete("/deleteOrder/:orderId", deleteOrder);

export default router;
