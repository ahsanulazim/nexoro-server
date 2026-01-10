import express from "express"
import { createCategory, getCategories } from "../controllers/categoryController.js";

const router = express.Router();

//Routes
router.post("/", createCategory);
router.get("/allCategories", getCategories);

export default router;