import express from "express";

import upload from "../middleware/uploadCloudinary.js";
import { createService } from "../controllers/serviceController.js";

const router = express.Router();

//Routes
router.post("/", upload.single("icon"), createService);

export default router;
