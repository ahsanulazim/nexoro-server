import express from "express";
import { createPlan, editPlan, getPlans } from "../controllers/planController.js";

const router = express.Router();

//Routes
router.put("/:slug", createPlan);
router.put("/:slug/:planId", editPlan);
router.get("/:selectedSlug", getPlans);

export default router;
