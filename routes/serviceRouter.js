import express from "express";

import upload from "../middleware/uploadCloudinary.js";
import { createService, getAllServices } from "../controllers/serviceController.js";

const router = express.Router();

//Routes
router.post("/", upload.single("icon"), createService);
router.get("/", getAllServices);

export default router;
