import express from "express";
import {
  getToken,
  handlePayment,
  verifyPayment,
} from "../controllers/paymentController.js";
import { confirmOrder } from "../controllers/orderController.js";
import {
  createDealPaymentLink,
  getDealDetails,
  initializeDealEPS,
  confirmDealEPS,
} from "../controllers/dealController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdminOrMember } from "../middleware/verifyAdminOrMember.js";

const router = express.Router();

// Standard EPS Routes
router.post("/eps/get-token", getToken);
router.post("/eps/initialize-payment", handlePayment);
router.get("/eps/confirm-order", verifyPayment, confirmOrder);

// Custom Deal & Unified Inbox Pay-by-Link Routes
router.post(
  "/deals/create-link",
  verifyId,
  verifyAdminOrMember,
  createDealPaymentLink
);
router.get("/deals/:dealId", getDealDetails);
router.post("/deals/:dealId/pay-eps", initializeDealEPS);
router.get("/deals/:dealId/confirm-eps", confirmDealEPS);

export default router;
