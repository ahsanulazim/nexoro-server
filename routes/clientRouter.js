import express from "express";
import {
  createClient,
  getAllClients,
} from "../controllers/clientController.js";
import upload from "../middleware/uploadCloudinary.js";

const router = express.Router();

//Routes
router.get("/", getAllClients);
router.post("/", upload.single("logo"), createClient);

export default router;
