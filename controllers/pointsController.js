import { ObjectId } from "mongodb";
import client from "../config/db.js";
import { io } from "../socket/socket.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";

const pointsLogCollection = client.db("nexoro").collection("PointsLogs");
const workSubmissionCollection = client
  .db("nexoro")
  .collection("WorkSubmissions");
const userCollection = client.db("nexoro").collection("Users");
const teamCollection = client.db("nexoro").collection("Team");

// Initialize indexes for fast monthly leaderboard & history queries
(async () => {
  try {
    await pointsLogCollection.createIndex({ monthKey: 1, userId: 1 });
    await pointsLogCollection.createIndex({ userId: 1, createdAt: -1 });
    await pointsLogCollection.createIndex({ orderId: 1, status: 1 });
    await workSubmissionCollection.createIndex({ status: 1, createdAt: -1 });
    await workSubmissionCollection.createIndex({ userId: 1, createdAt: -1 });
  } catch (err) {
    console.error("Points index initialization error:", err);
  }
})();

// Helper: Get current YYYY-MM key (Bangladesh Standard Time UTC+6 aware)
export const getCurrentMonthKey = (date = new Date()) => {
  const d = new Date(date);
  // Shift to UTC+6 (Asia/Dhaka) so midnight reset aligns with local agency time
  const bdTime = new Date(d.getTime() + 6 * 60 * 60 * 1000);
  const year = bdTime.getUTCFullYear();
  const month = String(bdTime.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

// Helper: Resolve member/user profile from an ID, email, or name
export const resolveStaffUser = async (identifier, fallbackEmail = null) => {
  if (!identifier && !fallbackEmail) return null;

  let userDoc = null;
  let teamDoc = null;

  const idStr = identifier ? String(identifier).trim() : "";

  if (idStr && ObjectId.isValid(idStr)) {
    userDoc = await userCollection.findOne({ _id: new ObjectId(idStr) });
    if (!userDoc) {
      teamDoc = await teamCollection.findOne({ _id: new ObjectId(idStr) });
    }
  }

  if (!userDoc && (fallbackEmail || idStr.includes("@"))) {
    const emailToFind = (fallbackEmail || idStr).toLowerCase().trim();
    userDoc = await userCollection.findOne({
      email: { $regex: new RegExp(`^${emailToFind}$`, "i") },
    });
    if (!teamDoc) {
      teamDoc = await teamCollection.findOne({
        email: { $regex: new RegExp(`^${emailToFind}$`, "i") },
      });
    }
  }

  if (!userDoc && teamDoc?.email) {
    userDoc = await userCollection.findOne({
      email: { $regex: new RegExp(`^${teamDoc.email.trim()}$`, "i") },
    });
  }

  if (!userDoc && idStr && !ObjectId.isValid(idStr) && !idStr.includes("@")) {
    userDoc = await userCollection.findOne({
      name: { $regex: new RegExp(`^${idStr}$`, "i") },
    });
    if (!teamDoc) {
      teamDoc = await teamCollection.findOne({
        memberName: { $regex: new RegExp(`^${idStr}$`, "i") },
      });
    }
  }

  if (!teamDoc && userDoc?.email) {
    teamDoc = await teamCollection.findOne({
      email: { $regex: new RegExp(`^${userDoc.email.trim()}$`, "i") },
    });
  }

  if (!userDoc && !teamDoc) return null;

  return {
    userId: userDoc?._id
      ? userDoc._id.toString()
      : teamDoc?._id
        ? teamDoc._id.toString()
        : idStr,
    userEmail: (userDoc?.email || teamDoc?.email || "").toLowerCase(),
    userName:
      userDoc?.name ||
      userDoc?.displayName ||
      teamDoc?.memberName ||
      userDoc?.email ||
      "Team Member",
    userRole: userDoc?.role || teamDoc?.role || "member",
    profilePic: userDoc?.photoURL || teamDoc?.profilePic || null,
  };
};

// Emit real-time socket update for points & leaderboard
export const broadcastPointsUpdate = (payload = {}) => {
  try {
    io.to("admin_global_room").emit("pointsUpdated", {
      timestamp: new Date(),
      ...payload,
    });
  } catch (err) {
    console.error("Broadcast points update error:", err);
  }
};

/**
 * Sync automated points when an Order/Project transitions between Completed and Incomplete
 * - Awards points (`order.rewardPoints ?? 5`) when order becomes Completed
 * - Deducts/reverts points when order is unchecked back to Processing or Cancelled
 */
export const syncOrderCompletionPoints = async ({
  order,
  newStatus,
  previousStatus,
}) => {
  try {
    if (!order || !order._id) return null;

    const orderMongoId = order._id.toString();
    const orderCode = order.orderId || `ORD-${orderMongoId.slice(-5)}`;
    const rewardPoints =
      order.rewardPoints !== undefined && order.rewardPoints !== null
        ? Math.max(0, Number(order.rewardPoints))
        : 5;

    const isNowCompleted =
      String(newStatus || "").toLowerCase() === "completed";
    const wasCompleted =
      String(previousStatus || "").toLowerCase() === "completed";

    // Case 1: Order just became Completed -> Award points if not already active
    if (isNowCompleted && !wasCompleted) {
      if (!order.assignedTo || rewardPoints <= 0) return null;

      // Check if an active points award already exists for this order
      const existingActive = await pointsLogCollection.findOne({
        orderId: orderMongoId,
        type: "project_completed",
        status: "active",
      });

      if (existingActive) {
        return existingActive; // Already awarded, prevent duplicate points
      }

      const staff = await resolveStaffUser(
        order.assignedTo,
        order.assignedMemberEmail,
      );
      if (!staff || staff.userRole === "admin") return null;

      const now = new Date();
      const monthKey = getCurrentMonthKey(now);
      const serviceTitle =
        order.serviceName || order.serviceTitle || order.service || "Project";

      const logDoc = {
        userId: staff.userId,
        userEmail: staff.userEmail,
        userName: staff.userName,
        userRole: staff.userRole,
        points: rewardPoints,
        type: "project_completed",
        status: "active",
        title: `Completed Project: ${serviceTitle} (#${orderCode})`,
        description: `All tasks marked as completed for order #${orderCode}.`,
        orderId: orderMongoId,
        orderUid: orderCode,
        monthKey,
        createdAt: now,
      };

      const insertRes = await pointsLogCollection.insertOne(logDoc);

      await createAndSendNotification({
        type: "points_earned",
        title: `+${rewardPoints} Points Earned!`,
        message: `You earned +${rewardPoints} points for completing project #${orderCode} (${serviceTitle}).`,
        link: "/dashboard/points",
        recipientId: staff.userId,
      });

      broadcastPointsUpdate({
        userId: staff.userId,
        action: "project_completed",
        points: rewardPoints,
      });

      return { ...logDoc, _id: insertRes.insertedId };
    }

    // Case 2: Order was Completed, now unchecked/reopened or Cancelled -> Deduct/Revert points
    if (!isNowCompleted && wasCompleted) {
      const existingActive = await pointsLogCollection.findOne({
        orderId: orderMongoId,
        type: "project_completed",
        status: "active",
      });

      if (!existingActive) return null;

      // Mark the active points log as reverted so monthly & all-time sums automatically deduct it,
      // and also record a visible deduction entry in history for transparency
      const now = new Date();
      await pointsLogCollection.updateOne(
        { _id: existingActive._id },
        {
          $set: {
            status: "reverted",
            revertedAt: now,
            revertReason: `Task unchecked / Order status changed to ${newStatus}`,
          },
        },
      );

      await createAndSendNotification({
        type: "points_deducted",
        title: `-${existingActive.points} Points Reverted`,
        message: `${existingActive.points} points were deducted because order #${orderCode} was marked incomplete.`,
        link: "/dashboard/points",
        recipientId: existingActive.userId,
      });

      broadcastPointsUpdate({
        userId: existingActive.userId,
        action: "project_reverted",
        points: -existingActive.points,
      });

      return existingActive;
    }

    return null;
  } catch (error) {
    console.error("Error syncing order completion points:", error);
    return null;
  }
};

// ============================================================================
// 1. Submit Extra / Daily Work (Member / Staff)
// ============================================================================
export const submitExtraWork = async (req, res) => {
  try {
    const { title, description, proofLink, workDate } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "Work title is required",
      });
    }

    const callerEmail = req.user?.email?.toLowerCase();
    if (!callerEmail) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const caller = await userCollection.findOne({
      email: { $regex: new RegExp(`^${callerEmail}$`, "i") },
    });

    if (!caller || caller.role !== "member") {
      return res.status(403).json({
        success: false,
        message: "Only team members can submit extra work",
      });
    }

    const staff = await resolveStaffUser(caller._id, caller.email);
    const now = new Date();
    const parsedWorkDate = workDate ? new Date(workDate) : now;
    const monthKey = getCurrentMonthKey(now);

    const submissionDoc = {
      userId: staff?.userId || caller._id.toString(),
      userEmail: caller.email.toLowerCase(),
      userName:
        caller.name || caller.displayName || staff?.userName || caller.email,
      userRole: caller.role,
      title: String(title).trim(),
      description: description ? String(description).trim() : "",
      proofLink: proofLink ? String(proofLink).trim() : "",
      workDate: parsedWorkDate,
      status: "Pending", // Pending | Approved | Rejected
      awardedPoints: 0,
      adminNote: "",
      reviewedBy: null,
      reviewedAt: null,
      monthKey,
      createdAt: now,
    };

    const result = await workSubmissionCollection.insertOne(submissionDoc);

    // Notify Admin in real-time
    await createAndSendNotification({
      type: "work_submitted",
      title: "New Extra Work Submitted",
      message: `${submissionDoc.userName} submitted "${submissionDoc.title}" for points review.`,
      link: "/dashboard/points?tab=approvals",
      recipientRole: "admin",
    });

    broadcastPointsUpdate({
      action: "work_submitted",
      submissionId: result.insertedId.toString(),
    });

    return res.status(200).json({
      success: true,
      message: "Work submitted successfully for admin approval",
      submission: { ...submissionDoc, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Submit extra work error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit extra work",
    });
  }
};

// ============================================================================
// 2. Get Work Submissions (Admin sees all/filtered; Member sees own)
// ============================================================================
export const getWorkSubmissions = async (req, res) => {
  try {
    const callerEmail = req.user?.email?.toLowerCase();
    const caller = callerEmail
      ? await userCollection.findOne({
          email: { $regex: new RegExp(`^${callerEmail}$`, "i") },
        })
      : null;

    if (!caller) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const isAdmin = caller.role === "admin";
    const statusFilter = (req.query.status || "all").toLowerCase();
    const scope = (req.query.scope || "").toLowerCase(); // "my" or "all"
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const skip = (page - 1) * limit;

    const query = {};

    // Non-admins or explicit "my" scope only see their own submissions
    if (!isAdmin || scope === "my") {
      query.$or = [
        { userId: caller._id.toString() },
        { userEmail: caller.email.toLowerCase() },
      ];
    }

    if (statusFilter !== "all") {
      query.status = { $regex: new RegExp(`^${statusFilter}$`, "i") };
    }

    // Count status breakdown
    const baseCountMatch =
      !isAdmin || scope === "my"
        ? {
            $or: [
              { userId: caller._id.toString() },
              { userEmail: caller.email.toLowerCase() },
            ],
          }
        : {};

    const [submissions, totalCount, statusGroups] = await Promise.all([
      workSubmissionCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      workSubmissionCollection.countDocuments(query),
      workSubmissionCollection
        .aggregate([
          { $match: baseCountMatch },
          {
            $group: {
              _id: { $toLower: { $ifNull: ["$status", "pending"] } },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);

    const counts = {
      all: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };

    statusGroups.forEach((g) => {
      counts.all += g.count;
      if (g._id in counts) {
        counts[g._id] = g.count;
      }
    });

    return res.status(200).json({
      success: true,
      submissions,
      counts,
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        totalCount,
        limit,
      },
    });
  } catch (error) {
    console.error("Get work submissions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch work submissions",
    });
  }
};

// ============================================================================
// 3. Review Work Submission: Approve (with custom points) or Reject (Admin Only)
// ============================================================================
export const reviewWorkSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, points, adminNote } = req.body; // action: "approve" | "reject"

    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid submission ID is required",
      });
    }

    const callerEmail = req.user?.email?.toLowerCase();
    const caller = callerEmail
      ? await userCollection.findOne({
          email: { $regex: new RegExp(`^${callerEmail}$`, "i") },
        })
      : null;

    if (!caller || caller.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only administrators can review work submissions",
      });
    }

    const submission = await workSubmissionCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Work submission not found",
      });
    }

    if (submission.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `This submission has already been ${submission.status.toLowerCase()}`,
      });
    }

    const normalizedAction = String(action || "").toLowerCase();
    if (!["approve", "reject"].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        message: "Action must be either 'approve' or 'reject'",
      });
    }

    const now = new Date();
    const reviewerName = caller.name || caller.displayName || "Admin";

    if (normalizedAction === "approve") {
      const awardedPoints = Number(points);
      if (isNaN(awardedPoints) || awardedPoints <= 0) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid positive point value",
        });
      }

      const monthKey = getCurrentMonthKey(now);

      await workSubmissionCollection.updateOne(
        { _id: submission._id },
        {
          $set: {
            status: "Approved",
            awardedPoints,
            adminNote: adminNote ? String(adminNote).trim() : "",
            reviewedBy: reviewerName,
            reviewedAt: now,
          },
        },
      );

      // Insert into PointsLogs so user profile & live leaderboard update immediately
      const logDoc = {
        userId: submission.userId,
        userEmail: submission.userEmail,
        userName: submission.userName,
        userRole: submission.userRole || "member",
        points: awardedPoints,
        type: "extra_work",
        status: "active",
        title: `Extra Work: ${submission.title}`,
        description:
          submission.description ||
          (adminNote ? `Admin note: ${adminNote}` : "Approved extra work"),
        submissionId: submission._id.toString(),
        proofLink: submission.proofLink || "",
        reviewedBy: reviewerName,
        monthKey,
        createdAt: now,
      };

      await pointsLogCollection.insertOne(logDoc);

      await createAndSendNotification({
        type: "points_earned",
        title: `Extra Work Approved! (+${awardedPoints} pts)`,
        message: `Your submission "${submission.title}" was approved with +${awardedPoints} points!`,
        link: "/dashboard/points",
        recipientId: submission.userId,
      });

      broadcastPointsUpdate({
        userId: submission.userId,
        action: "work_approved",
        points: awardedPoints,
      });

      return res.status(200).json({
        success: true,
        message: `Work approved! +${awardedPoints} points added to ${submission.userName}.`,
      });
    } else {
      // Reject
      await workSubmissionCollection.updateOne(
        { _id: submission._id },
        {
          $set: {
            status: "Rejected",
            awardedPoints: 0,
            adminNote: adminNote ? String(adminNote).trim() : "",
            reviewedBy: reviewerName,
            reviewedAt: now,
          },
        },
      );

      await createAndSendNotification({
        type: "work_rejected",
        title: "Extra Work Submission Update",
        message: `Your submission "${submission.title}" was not approved.${adminNote ? ` Reason: ${adminNote}` : ""}`,
        link: "/dashboard/points",
        recipientId: submission.userId,
      });

      broadcastPointsUpdate({
        userId: submission.userId,
        action: "work_rejected",
      });

      return res.status(200).json({
        success: true,
        message: "Work submission rejected.",
      });
    }
  } catch (error) {
    console.error("Review work submission error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to review work submission",
    });
  }
};

// ============================================================================
// 4. Get Live Leaderboard & Ranking (Auto-resets every 1st of month via monthKey)
// ============================================================================
export const getLeaderboard = async (req, res) => {
  try {
    const currentMonthKey = getCurrentMonthKey();
    // Allow viewing current month (default), specific YYYY-MM, or "all_time"
    const requestedPeriod = (req.query.month || currentMonthKey).trim();
    const isAllTime = requestedPeriod.toLowerCase() === "all_time";

    // Self-heal: Ensure any "Approved" WorkSubmissions with awardedPoints > 0 have a corresponding PointsLogs entry
    const approvedSubmissions = await workSubmissionCollection
      .find({ status: "Approved", awardedPoints: { $gt: 0 } })
      .toArray();

    if (approvedSubmissions.length > 0) {
      const subIds = approvedSubmissions.map((s) => s._id.toString());
      const existingLogs = await pointsLogCollection
        .find({ submissionId: { $in: subIds } })
        .project({ submissionId: 1 })
        .toArray();
      const loggedSubIds = new Set(existingLogs.map((l) => l.submissionId));

      const missingLogs = approvedSubmissions
        .filter((s) => !loggedSubIds.has(s._id.toString()))
        .map((s) => ({
          userId: s.userId,
          userEmail: (s.userEmail || "").toLowerCase().trim(),
          userName: s.userName || "Team Member",
          userRole: s.userRole || "member",
          points: Number(s.awardedPoints) || 0,
          type: "extra_work",
          status: "active",
          title: `Extra Work: ${s.title}`,
          description: s.description || "Approved extra work",
          submissionId: s._id.toString(),
          proofLink: s.proofLink || "",
          reviewedBy: s.reviewedBy || "Admin",
          monthKey: s.monthKey || getCurrentMonthKey(s.reviewedAt || s.createdAt),
          createdAt: s.reviewedAt || s.createdAt || new Date(),
        }));

      if (missingLogs.length > 0) {
        await pointsLogCollection.insertMany(missingLogs);
      }
    }

    // 1. Get ONLY registered users with role: "member" (plus Team docs only for profile picture/job title enrichment)
    const [memberUsers, teamDocs] = await Promise.all([
      userCollection
        .find({ role: "member" })
        .project({ _id: 1, name: 1, displayName: 1, email: 1, role: 1, photoURL: 1 })
        .toArray(),
      teamCollection.find({}).toArray(),
    ]);

    const teamByEmail = new Map();
    teamDocs.forEach((t) => {
      if (t.email) teamByEmail.set(t.email.toLowerCase().trim(), t);
    });

    // 2. Aggregate active points logs for the requested period
    const matchStage = { status: "active" };
    if (!isAllTime) {
      matchStage.monthKey = requestedPeriod;
    }

    const pointsAgg = await pointsLogCollection
      .aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              $cond: [
                { $ne: [{ $ifNull: ["$userEmail", ""] }, ""] },
                { $toLower: "$userEmail" },
                "$userId",
              ],
            },
            userId: { $first: "$userId" },
            userEmail: { $first: "$userEmail" },
            userName: { $first: "$userName" },
            totalPoints: { $sum: "$points" },
            projectPoints: {
              $sum: {
                $cond: [{ $eq: ["$type", "project_completed"] }, "$points", 0],
              },
            },
            extraWorkPoints: {
              $sum: {
                $cond: [{ $eq: ["$type", "extra_work"] }, "$points", 0],
              },
            },
            completedProjectsCount: {
              $sum: {
                $cond: [{ $eq: ["$type", "project_completed"] }, 1, 0],
              },
            },
            extraWorksCount: {
              $sum: {
                $cond: [{ $eq: ["$type", "extra_work"] }, 1, 0],
              },
            },
            lastEarnedAt: { $max: "$createdAt" },
          },
        },
      ])
      .toArray();

    // Also get distinct available months using aggregation (compatible with MongoDB Stable API Strict Mode)
    const distinctMonthsAgg = await pointsLogCollection
      .aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$monthKey" } },
      ])
      .toArray();
    const distinctMonths = distinctMonthsAgg.map((d) => d._id).filter(Boolean);
    const availableMonths = Array.from(
      new Set([currentMonthKey, ...distinctMonths]),
    )
      .sort()
      .reverse();

    // Map aggregated points by email and userId
    const aggByEmail = new Map();
    const aggById = new Map();
    pointsAgg.forEach((entry) => {
      if (entry.userEmail) {
        aggByEmail.set(entry.userEmail.toLowerCase().trim(), entry);
      }
      if (entry.userId) {
        aggById.set(String(entry.userId), entry);
      }
    });

    // Build leaderboard strictly from registered users with role: "member"
    const leaderboardMap = new Map();

    memberUsers.forEach((u) => {
      const emailKey = (u.email || "").toLowerCase().trim();
      const idStr = u._id.toString();
      const teamInfo = teamByEmail.get(emailKey);
      const stats = aggByEmail.get(emailKey) || aggById.get(idStr);

      leaderboardMap.set(emailKey || idStr, {
        userId: idStr,
        userEmail: emailKey,
        userName:
          u.name || u.displayName || teamInfo?.memberName || u.email || "Member",
        role: teamInfo?.role || "Team Member",
        systemRole: "member",
        profilePic: teamInfo?.profilePic || u.photoURL || null,
        totalPoints: stats?.totalPoints || 0,
        projectPoints: stats?.projectPoints || 0,
        extraWorkPoints: stats?.extraWorkPoints || 0,
        completedProjectsCount: stats?.completedProjectsCount || 0,
        extraWorksCount: stats?.extraWorksCount || 0,
        lastEarnedAt: stats?.lastEarnedAt || null,
      });
    });

    // Sort by totalPoints DESC, then completedProjectsCount DESC, then name ASC
    const sorted = Array.from(leaderboardMap.values()).sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.completedProjectsCount !== a.completedProjectsCount) {
        return b.completedProjectsCount - a.completedProjectsCount;
      }
      return (a.userName || "").localeCompare(b.userName || "");
    });

    const rankedLeaderboard = sorted.map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));

    // Calculate next auto-reset date (1st of next month)
    const now = new Date();
    const bdNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const nextResetDate = new Date(
      Date.UTC(bdNow.getUTCFullYear(), bdNow.getUTCMonth() + 1, 1, 0, 0, 0) -
        6 * 60 * 60 * 1000,
    );

    return res.status(200).json({
      success: true,
      period: requestedPeriod,
      currentMonthKey,
      isCurrentMonth: requestedPeriod === currentMonthKey,
      nextResetDate,
      availableMonths,
      leaderboard: rankedLeaderboard,
    });
  } catch (error) {
    console.error("Get leaderboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
    });
  }
};

// ============================================================================
// 5. Get User's Own Points Profile & History (or specific user for Admin)
// ============================================================================
export const getMyPointsSummary = async (req, res) => {
  try {
    const callerEmail = req.user?.email?.toLowerCase();
    const caller = callerEmail
      ? await userCollection.findOne({
          email: { $regex: new RegExp(`^${callerEmail}$`, "i") },
        })
      : null;

    if (!caller) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const isAdmin = caller.role === "admin";
    const targetUserId =
      isAdmin && req.query.userId ? req.query.userId : caller._id.toString();
    const targetEmail =
      isAdmin && req.query.userEmail
        ? req.query.userEmail.toLowerCase()
        : caller.email.toLowerCase();

    const currentMonthKey = getCurrentMonthKey();

    const userMatch = {
      $or: [{ userId: targetUserId }, { userEmail: targetEmail }],
    };

    const [historyLogs, pendingSubmissionsCount, allTimeAgg, monthAgg] =
      await Promise.all([
        pointsLogCollection
          .find(userMatch)
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray(),
        workSubmissionCollection.countDocuments({
          ...userMatch,
          status: "Pending",
        }),
        pointsLogCollection
          .aggregate([
            { $match: { ...userMatch, status: "active" } },
            {
              $group: {
                _id: null,
                totalPoints: { $sum: "$points" },
                projectPoints: {
                  $sum: {
                    $cond: [
                      { $eq: ["$type", "project_completed"] },
                      "$points",
                      0,
                    ],
                  },
                },
                extraWorkPoints: {
                  $sum: {
                    $cond: [{ $eq: ["$type", "extra_work"] }, "$points", 0],
                  },
                },
                completedProjects: {
                  $sum: {
                    $cond: [{ $eq: ["$type", "project_completed"] }, 1, 0],
                  },
                },
                approvedExtraWorks: {
                  $sum: {
                    $cond: [{ $eq: ["$type", "extra_work"] }, 1, 0],
                  },
                },
              },
            },
          ])
          .toArray(),
        pointsLogCollection
          .aggregate([
            {
              $match: {
                ...userMatch,
                status: "active",
                monthKey: currentMonthKey,
              },
            },
            {
              $group: {
                _id: null,
                monthlyPoints: { $sum: "$points" },
                monthlyProjectPoints: {
                  $sum: {
                    $cond: [
                      { $eq: ["$type", "project_completed"] },
                      "$points",
                      0,
                    ],
                  },
                },
                monthlyExtraPoints: {
                  $sum: {
                    $cond: [{ $eq: ["$type", "extra_work"] }, "$points", 0],
                  },
                },
                monthlyProjectsCount: {
                  $sum: {
                    $cond: [{ $eq: ["$type", "project_completed"] }, 1, 0],
                  },
                },
                monthlyExtraCount: {
                  $sum: {
                    $cond: [{ $eq: ["$type", "extra_work"] }, 1, 0],
                  },
                },
              },
            },
          ])
          .toArray(),
      ]);

    // Also count total pending submissions across agency if caller is admin
    const adminPendingTotal = isAdmin
      ? await workSubmissionCollection.countDocuments({ status: "Pending" })
      : 0;

    const allTime = allTimeAgg[0] || {};
    const monthly = monthAgg[0] || {};

    return res.status(200).json({
      success: true,
      currentMonthKey,
      summary: {
        monthlyPoints: monthly.monthlyPoints || 0,
        monthlyProjectPoints: monthly.monthlyProjectPoints || 0,
        monthlyExtraPoints: monthly.monthlyExtraPoints || 0,
        monthlyProjectsCount: monthly.monthlyProjectsCount || 0,
        monthlyExtraCount: monthly.monthlyExtraCount || 0,
        allTimePoints: allTime.totalPoints || 0,
        allTimeProjectPoints: allTime.projectPoints || 0,
        allTimeExtraPoints: allTime.extraWorkPoints || 0,
        completedProjects: allTime.completedProjects || 0,
        approvedExtraWorks: allTime.approvedExtraWorks || 0,
        pendingSubmissionsCount,
        adminPendingTotal,
      },
      history: historyLogs,
    });
  } catch (error) {
    console.error("Get my points summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch points summary",
    });
  }
};

