import express from "express";
import { createPlan } from "../controllers/planController.js";

const router = express.Router();

//Routes
router.put("/:slug", createPlan);

export default router;
