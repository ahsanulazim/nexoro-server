import express from "express";

import upload from "../middleware/uploadCloudinary.js";
import {
  createService,
  deleteServices,
  getAllServices,
  getService,
  updateService,
} from "../controllers/serviceController.js";

const router = express.Router();

//Routes
router.post(
  "/",
  upload.fields([
    { name: "icon", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  createService
);
router.get("/", getAllServices);
router.get("/:slug", getService);
router.delete("/:slug", deleteServices);
router.put(
  "/:id",
  upload.fields([
    { name: "icon", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  updateService
);

export default router;
