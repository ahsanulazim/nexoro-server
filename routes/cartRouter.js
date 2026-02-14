import express from "express";
import { addToCart } from "../controllers/cartController.js";

const router = express.Router();

//Routes
router.get("/checkout", addToCart);

export default router;