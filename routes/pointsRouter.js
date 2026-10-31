import express from "express";
import {
  submitExtraWork,
  getWorkSubmissions,
  reviewWorkSubmission,
  getLeaderboard,
  getMyPointsSummary,
} from "../controllers/pointsController.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";

const router = express.Router();

// Submit extra/daily work (Member/Admin)
router.post("/submit-work", verifyId, submitExtraWork);

// Get work submissions (Admin sees all, Member sees own)
router.get("/submissions", verifyId, getWorkSubmissions);

// Admin approve/reject work submission & assign custom points
router.patch("/submissions/:id/review", verifyId, verifyAdmin, reviewWorkSubmission);

// Get live monthly or all-time leaderboard
router.get("/leaderboard", verifyId, getLeaderboard);

// Get user's points profile & history
router.get("/my-summary", verifyId, getMyPointsSummary);

export default router;

