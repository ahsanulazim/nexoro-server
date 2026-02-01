import express from "express";
import { addToCart } from "../controllers/cartController.js";

const router = express.Router();

//Routes
router.get("/:slug/plans/:id", addToCart);

export default router;