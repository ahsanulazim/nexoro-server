import express from "express";
import {
  createSubService,
  getSubServices,
} from "../controllers/subServicesController.js";

const router = express.Router();

//Routes
router.post("/", createSubService);
router.get("/allSubServices", getSubServices);

export default router;
