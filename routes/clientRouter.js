import express from "express";
import { createClient, deleteClient, getAllClients, updateClient } from "../controllers/clientController.js";
import upload from "../middleware/uploadCloudinary.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";

const router = express.Router();

//Routes
router.get("/", getAllClients);
router.post("/", upload.single("logo"), createClient);
router.put("/:id", upload.single("logo"), updateClient);
router.delete("/:email", deleteFromCloudinary, deleteClient);

export default router;
