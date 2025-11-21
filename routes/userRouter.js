import express from "express";
import {
  createUser,
  deleteUser,
  getAllUsers,
  getUser,
  updateUser,
} from "../controllers/userController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";

const router = express.Router();

// routes
router.post("/", createUser);
router.get("/:email", getUser);
router.get("/", getAllUsers);
router.put("/:email", updateUser);
router.delete("/:email", verifyId, verifyAdmin, deleteUser);

export default router;
