import express from "express";
import {
  createOrder,
  createUser,
  deleteUser,
  demoteMember,
  getAllMembers,
  getAllUsers,
  getUser,
  promoteUser,
  updateUser,
} from "../controllers/userController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";

const router = express.Router();

// routes
router.post("/", createUser);
router.get("/getUser", getUser);
router.get("/", verifyId, verifyAdmin, getAllUsers);
router.get("/team/members", getAllMembers);
router.put("/:email", updateUser);
router.put("/promote/:email", promoteUser);
router.put("/demote/:email", demoteMember);
router.put("/cart/:email/:slug/plans/:id", createOrder);
router.delete("/:remove", verifyId, verifyAdmin, deleteUser);

export default router;
