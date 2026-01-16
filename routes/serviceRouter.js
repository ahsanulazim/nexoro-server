import express from "express";

import upload from "../middleware/uploadCloudinary.js";
import {
  createService,
  deleteServices,
  getAllServices,
  getService,
  updateService,
} from "../controllers/serviceController.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";

const router = express.Router();

//Routes
router.post("/", upload.single("icon"), createService);
router.get("/", getAllServices);
router.get("/:slug", getService);
router.delete("/:slug", deleteFromCloudinary, deleteServices);
router.put("/:id", upload.single("icon"), updateService);

export default router;
