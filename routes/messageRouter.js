import { Router } from "express";
import {
  getMessages,
  getSidebarConversations,
  sendMessage,
  uploadAttachments,
  deleteConversation,
  getCustomerCRMDetails,
  confirmOrderFromChat,
  addInternalNote,
  deleteInternalNote,
  getCannedResponses,
  createCannedResponse,
} from "../controllers/messageController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
import { verifyAdminOrMember } from "../middleware/verifyAdminOrMember.js";
import upload from "../middleware/uploadCloudinary.js";

const messageRouter = Router();

// Routes
messageRouter.post(
  "/uploadAttachments",
  verifyId,
  upload.array("files", 10),
  uploadAttachments
);
messageRouter.post(
  "/sendMessage",
  verifyId,
  upload.fields([{ name: "files" }, { name: "file" }]),
  sendMessage,
);
messageRouter.get("/getMessages", verifyId, getMessages);
messageRouter.get(
  "/getSidebarConversations",
  verifyId,
  getSidebarConversations,
);
messageRouter.delete("/deleteConversation", verifyAdmin, deleteConversation);

// CRM & Notes Routes
messageRouter.get("/crmDetails", verifyId, getCustomerCRMDetails);
messageRouter.post(
  "/confirmOrderFromChat",
  verifyId,
  verifyAdminOrMember,
  confirmOrderFromChat,
);
messageRouter.post("/addNote", verifyId, addInternalNote);
messageRouter.delete("/deleteNote", verifyId, deleteInternalNote);

// Canned Responses Routes
messageRouter.get("/cannedResponses", verifyId, getCannedResponses);
messageRouter.post("/cannedResponses", verifyId, createCannedResponse);

export default messageRouter;
