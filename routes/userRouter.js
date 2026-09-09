import express from "express";
import {
  createUser,
  deleteUser,
  demoteMember,
  getAllMembers,
  getAllUsers,
  getAssignableUsers,
  getUser,
  promoteUser,
  updateUser,
} from "../controllers/userController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";

const router = express.Router();

// routes
router.post("/add", verifyId, createUser);
router.get("/getUser", verifyId, getUser);
router.get("/", verifyId, verifyAdmin, getAllUsers);
router.get("/team/members", getAllMembers);
router.get("/assignable", verifyId, getAssignableUsers);
router.put("/updateUser", verifyId, updateUser);
router.put("/promote", promoteUser);
router.put("/demote", demoteMember);
router.delete("/delete", verifyId, verifyAdmin, deleteUser);

export default router;
