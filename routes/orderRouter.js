import express from "express";
import {
  assignOrderToMember,
  createOrder,
  deleteOrder,
  getAllCountries,
  getAllOrders,
  getOrder,
  updateOrder,
  updateOrderStatus,
  updateOrderTasks,
  updateOrderCosts,
} from "../controllers/orderController.js";
import { verifyId } from "../middleware/verifyId.js";

const router = express.Router();

//Routes
router.post("/createOrder", createOrder);
router.put("/updateOrder", updateOrder);
router.get("/getAllOrders", getAllOrders);
router.get("/getOrder", getOrder);
router.get("/countries", getAllCountries);
router.put("/updateOrderStatus/:orderId", updateOrderStatus);
router.put("/updateOrderStatus", updateOrderStatus);
router.put("/assignOrderToMember", verifyId, assignOrderToMember);
router.put("/updateTasks", verifyId, updateOrderTasks);
router.put("/updateCosts", verifyId, updateOrderCosts);
router.delete("/deleteOrder/:orderId", deleteOrder);

export default router;
