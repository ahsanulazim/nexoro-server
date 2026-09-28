import express from "express";
import {
  assignOrderToMember,
  createOrder,
  deleteOrder,
  getAllCountries,
  getAllOrders,
  getMyOrders,
  getOrder,
  updateOrder,
  updateOrderStatus,
  updateOrderTasks,
  updateOrderCosts,
} from "../controllers/orderController.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
import { verifyId } from "../middleware/verifyId.js";

const router = express.Router();

//Routes
router.post("/createOrder", verifyId, createOrder);
router.put("/updateOrder", updateOrder);
router.get("/getAllOrders", getAllOrders);
router.get("/getMyOrders", verifyId, getMyOrders);
router.get("/getOrder", getOrder);
router.get("/countries", getAllCountries);
router.put("/updateOrderStatus/:orderId", verifyId, updateOrderStatus);
router.put("/updateOrderStatus", verifyId, updateOrderStatus);
router.put("/assignOrderToMember", verifyId, assignOrderToMember);
router.put("/updateTasks", verifyId, updateOrderTasks);
router.put("/updateCosts", verifyId, updateOrderCosts);
router.delete("/deleteOrder/:orderId", verifyAdmin, deleteOrder);

export default router;
