import express from "express";
import { addMember, deleteMember, getAllMembers, updateMember } from "../controllers/teamController.js";
import upload from "../middleware/uploadCloudinary.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";

const router = express.Router();

//Routes
router.post("/", upload.single("profilePic"), addMember);
router.get("/", getAllMembers);
router.delete("/:id", deleteFromCloudinary, deleteMember);
router.put("/:id", upload.single("profilePic"), updateMember);

export default router;