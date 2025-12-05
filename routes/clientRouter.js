import express from "express";
import { createClient, deleteClient, getAllClients } from "../controllers/clientController.js";
import upload from "../middleware/uploadCloudinary.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";

const router = express.Router();

//Routes
router.get("/", getAllClients);
router.post("/", upload.single("logo"), createClient);
router.delete("/:email", deleteFromCloudinary, deleteClient);

export default router;
