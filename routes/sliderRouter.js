import express from "express";
import { deleteClientSlider, updateSliderClients } from "../controllers/sliderController.js";
import { verifyPermission } from "../middleware/verifyPermission.js";

const router = express.Router();

//Routes
router.put("/clients", verifyPermission("sliders"), updateSliderClients);
router.put("/:id", verifyPermission("sliders"), deleteClientSlider);

export default router;