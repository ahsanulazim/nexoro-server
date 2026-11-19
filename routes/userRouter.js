import express from "express";
import {
  createUser,
  deleteUser,
  demoteMember,
  getAllMembers,
  getAllUsers,
  getAssignableUsers,
  getPermissionConfig,
  getUser,
  promoteUser,
  updateMemberPermissions,
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
router.get("/permissions/config", verifyId, getPermissionConfig);
router.put("/permissions", verifyId, verifyAdmin, updateMemberPermissions);
router.put("/updateUser", verifyId, updateUser);
router.put("/promote", verifyId, verifyAdmin, promoteUser);
router.put("/demote", verifyId, verifyAdmin, demoteMember);
router.delete("/delete", verifyId, verifyAdmin, deleteUser);

export default router;
