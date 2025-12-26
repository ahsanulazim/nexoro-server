import express from "express";
import { deleteClientSlider, updateSliderClients } from "../controllers/sliderController.js";

const router = express.Router();

//Routes
router.put("/clients", updateSliderClients)
router.put("/:id", deleteClientSlider)

export default router;