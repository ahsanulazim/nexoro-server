import express from "express";
import { addMember, getAllMembers } from "../controllers/teamController.js";
import upload from "../middleware/uploadCloudinary.js";

const router = express.Router();

//Routes
router.post("/", upload.single("profilePic"), addMember);
router.get("/", getAllMembers);

export default router;