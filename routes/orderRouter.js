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
} from "../controllers/orderController.js";

const router = express.Router();

//Routes
router.post("/createOrder", createOrder);
router.put("/updateOrder", updateOrder);
router.get("/getAllOrders", getAllOrders);
router.get("/getOrder", getOrder);
router.get("/countries", getAllCountries);
router.put("/updateOrderStatus", updateOrderStatus);
router.put("/assignOrderToMember", assignOrderToMember);
router.delete("/deleteOrder/:orderId", deleteOrder);

export default router;
