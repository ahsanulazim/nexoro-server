import client from "../config/db.js";
import admin from "../admin/firebase.config.js";
import { ObjectId } from "mongodb";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";
import {
  ALL_PERMISSION_IDS,
  DEFAULT_MEMBER_PERMISSIONS,
  PERMISSION_MODULES,
  PERMISSION_PRESETS,
} from "../config/permissions.js";

const userCollection = client.db("nexoro").collection("Users");
await userCollection.createIndex({ email: 1 }, { unique: true });

// Create new user
export const createUser = async (req, res) => {
  const { name, userName, email, photoURL, profilePic } = req.body;
  const uid = req.user?.uid;
  const emailVerified = req.user?.email_verified || false;
  // Check if sign-in provider is Google or picture is in token
  const resolvedPhotoURL = photoURL || profilePic || req.user?.picture || "";
  const resolvedName = name || userName || req.user?.name || "";
  const role = "customer";
  const createdAt = new Date();
  const newUser = {
    name: resolvedName,
    email,
    uid,
    role,
    photoURL: resolvedPhotoURL,
    profilePic: resolvedPhotoURL,
    emailVerified,
    createdAt,
  };
  try {
    const existingUser = await userCollection.findOne({ email });
    if (existingUser) {
      // If user exists and doesn't have a photoURL yet, save the new photoURL
      if ((!existingUser.photoURL || !existingUser.profilePic) && resolvedPhotoURL) {
        await userCollection.updateOne(
          { email },
          {
            $set: {
              ...(!existingUser.photoURL ? { photoURL: resolvedPhotoURL } : {}),
              ...(!existingUser.profilePic ? { profilePic: resolvedPhotoURL } : {}),
            },
          }
        );
        existingUser.photoURL = existingUser.photoURL || resolvedPhotoURL;
        existingUser.profilePic = existingUser.profilePic || resolvedPhotoURL;
      }
      return res.status(200).send({
        success: false,
        message: "User already exists",
        user: existingUser,
      });
    }
    await userCollection.insertOne(newUser);

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    return res.status(200).send({
      success: true,
      message: "User synced successfully",
      user: newUser,
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).send({ success: false, message: "Failed to create user" });
  }
};

// Get single user
export const getUser = async (req, res) => {
  try {
    const email = req.user.email;
    const user = await userCollection.findOne({ email });
    if (!user) {
      return res.status(200).send({
        success: false,
        message: "User not found",
      });
    }

    // Attach effective permissions for frontend consistency
    if (user.role === "admin") {
      user.permissions = ALL_PERMISSION_IDS;
    } else if (user.role === "member" && !Array.isArray(user.permissions)) {
      user.permissions = DEFAULT_MEMBER_PERMISSIONS;
    } else if (user.role !== "member") {
      user.permissions = [];
    }

    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Get user error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Get all customers
export const getAllUsers = async (req, res) => {
  try {
    const customer = await userCollection.find({ role: "customer" }).toArray();
    res.status(200).json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch customers", error });
  }
};

//Get all members
export const getAllMembers = async (req, res) => {
  try {
    const userMembers = await userCollection.find({ role: "member" }).toArray();
    const teamMembers = await client.db("nexoro").collection("Team").find().toArray();

    const teamMap = new Map();
    teamMembers.forEach((t) => {
      if (t.email) teamMap.set(t.email.toLowerCase(), t);
      if (t.memberName) teamMap.set(t.memberName.toLowerCase(), t);
    });

    const seenEmails = new Set();
    const combined = [];

    userMembers.forEach((m) => {
      const emailKey = (m.email || "").toLowerCase();
      const nameKey = (m.name || m.userName || "").toLowerCase();
      const matchedTeam = teamMap.get(emailKey) || teamMap.get(nameKey);
      if (emailKey) seenEmails.add(emailKey);

      const pic = m.profilePic || m.photoURL || matchedTeam?.profilePic || null;
      combined.push({
        ...m,
        profilePic: pic,
        photoURL: pic,
      });
    });

    teamMembers.forEach((t) => {
      const emailKey = (t.email || "").toLowerCase();
      if (emailKey && !seenEmails.has(emailKey)) {
        seenEmails.add(emailKey);
        combined.push({
          _id: t._id,
          name: t.memberName,
          email: t.email,
          role: t.role || "member",
          profilePic: t.profilePic,
          photoURL: t.profilePic,
          createdAt: t.joined || t.createdAt || new Date(),
          permissions: [],
        });
      }
    });

    res.status(200).json(combined);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch members", error });
  }
};

// Get assignable users (registered members and admins)
export const getAssignableUsers = async (req, res) => {
  try {
    const users = await userCollection
      .find({ role: { $in: ["member", "admin"] } })
      .project({ name: 1, email: 1, role: 1, uid: 1, photoURL: 1, profilePic: 1 })
      .sort({ role: 1, name: 1 })
      .toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error("Get assignable users error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch assignable users", error });
  }
};

// Promote User
export const promoteUser = async (req, res) => {
  const email = req.query.email || req.body?.email;
  const initialPermissions =
    req.body?.permissions && Array.isArray(req.body.permissions)
      ? req.body.permissions
      : DEFAULT_MEMBER_PERMISSIONS;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email query param or body required" });
  }

  try {
    const user = await userCollection.updateOne(
      { email },
      {
        $set: {
          role: "member",
          permissions: initialPermissions,
          promotedAt: new Date(),
        },
      },
    );
    if (user.modifiedCount > 0) {
      res.status(200).send({
        success: true,
        message: "User promoted to member",
        permissions: initialPermissions,
      });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};
// demote Member
export const demoteMember = async (req, res) => {
  const email = req.query.email || req.body?.email;
  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email query param or body required" });
  }

  try {
    const user = await userCollection.updateOne(
      { email },
      {
        $set: { role: "customer" },
        $unset: { permissions: "" },
      },
    );
    if (user.modifiedCount > 0) {
      res
        .status(200)
        .send({ success: true, message: "Member demoted to customer" });
    } else {
      res.status(404).send({ success: false, message: "Member not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};

// Update member permissions (Admin only)
export const updateMemberPermissions = async (req, res) => {
  const email = req.body?.email || req.query?.email;
  const { permissions } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Member email is required" });
  }

  if (!Array.isArray(permissions)) {
    return res
      .status(400)
      .json({ success: false, message: "Permissions must be an array of module IDs" });
  }

  // Filter against valid permissions
  const validPermissions = permissions.filter((p) =>
    ALL_PERMISSION_IDS.includes(p)
  );

  try {
    const result = await userCollection.updateOne(
      { email, role: "member" },
      {
        $set: {
          permissions: validPermissions,
          permissionsUpdatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      // Check if user exists but is not a member
      const existing = await userCollection.findOne({ email });
      if (!existing) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      return res.status(400).json({
        success: false,
        message: "Permissions can only be customized for team members",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully",
      permissions: validPermissions,
    });
  } catch (error) {
    console.error("Update permissions error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update permissions" });
  }
};

// Get available permissions configuration
export const getPermissionConfig = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      modules: PERMISSION_MODULES,
      presets: PERMISSION_PRESETS,
      defaultPermissions: DEFAULT_MEMBER_PERMISSIONS,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch permission config" });
  }
};

// Update user
export const updateUser = async (req, res) => {
  const decodedToken = req.user;

  if (!decodedToken || (!decodedToken.uid && !decodedToken.email)) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const uid = decodedToken.uid;
  const email = decodedToken.email;
  const updatedData = { ...req.body };

  // Keep photoURL and profilePic in sync for cross-feature consistency
  if (updatedData.photoURL && !updatedData.profilePic) {
    updatedData.profilePic = updatedData.photoURL;
  } else if (updatedData.profilePic && !updatedData.photoURL) {
    updatedData.photoURL = updatedData.profilePic;
  }

  try {
    const filterConditions = [];
    if (uid) filterConditions.push({ uid });
    if (email) filterConditions.push({ email: { $regex: new RegExp(`^${email.trim()}$`, "i") } });

    const filter = filterConditions.length > 1 ? { $or: filterConditions } : filterConditions[0];
    const result = await userCollection.updateOne(
      filter,
      { $set: updatedData },
    );
    if (result.matchedCount > 0) {
      res.status(200).send({ success: true, message: "User updated" });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  const email = req.query.email;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(userRecord.uid);
    const result = await userCollection.deleteOne({ email });
    if (result.deletedCount > 0) {
      // Real-time broadcast for dashboard stats
      broadcastDashboardStats().catch((err) =>
        console.error("Dashboard stats broadcast error:", err)
      );

      return res.send({ success: true, message: "User deleted successfully" });
    } else {
      return res.send({ success: false, message: "User not found in MongoDB" });
    }
  } catch (error) {
    console.error("Delete error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete user" });
  }
};

// Get Member Profile Stats & Analytics (Admin or self)
export const getMemberProfileStats = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Member ID is required" });
    }

    const orderCollection = client.db("nexoro").collection("Orders");
    const teamCollection = client.db("nexoro").collection("Team");
    const clientCollection = client.db("nexoro").collection("Clients");
    const pointsLogCollection = client.db("nexoro").collection("PointsLogs");

    // 1. Resolve user doc from Users collection or Team collection
    let userDoc = null;
    let teamDoc = null;

    if (ObjectId.isValid(id)) {
      userDoc = await userCollection.findOne({ _id: new ObjectId(id) });
      if (!userDoc) {
        teamDoc = await teamCollection.findOne({ _id: new ObjectId(id) });
      }
    }

    if (!userDoc && !teamDoc) {
      // Try by uid or email
      userDoc = await userCollection.findOne({
        $or: [
          { uid: id },
          { email: { $regex: new RegExp(`^${id}$`, "i") } },
        ],
      });
      if (!userDoc) {
        teamDoc = await teamCollection.findOne({
          email: { $regex: new RegExp(`^${id}$`, "i") },
        });
      }
    }

    if (!userDoc && !teamDoc) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    // Link userDoc and teamDoc if one was found
    const targetEmail = (userDoc?.email || teamDoc?.email || "").toLowerCase().trim();
    if (userDoc && !teamDoc && targetEmail) {
      teamDoc = await teamCollection.findOne({
        email: { $regex: new RegExp(`^${targetEmail}$`, "i") },
      });
    } else if (teamDoc && !userDoc && targetEmail) {
      userDoc = await userCollection.findOne({
        email: { $regex: new RegExp(`^${targetEmail}$`, "i") },
      });
    }

    const userIdStr = userDoc?._id ? userDoc._id.toString() : id;
    const teamIdStr = teamDoc?._id ? teamDoc._id.toString() : "";
    const memberName =
      userDoc?.name || userDoc?.displayName || userDoc?.userName || teamDoc?.memberName || "";

    // 2. Build match conditions for assigned orders
    const orMatch = [];
    if (userIdStr) {
      orMatch.push({ assignedTo: userIdStr });
      if (ObjectId.isValid(userIdStr)) {
        orMatch.push({ assignedTo: new ObjectId(userIdStr) });
      }
    }
    if (teamIdStr && teamIdStr !== userIdStr) {
      orMatch.push({ assignedTo: teamIdStr });
      if (ObjectId.isValid(teamIdStr)) {
        orMatch.push({ assignedTo: new ObjectId(teamIdStr) });
      }
    }
    if (targetEmail) {
      orMatch.push({ assignedMemberEmail: { $regex: new RegExp(`^${targetEmail}$`, "i") } });
    }
    if (memberName) {
      orMatch.push({ assignedTo: memberName });
    }

    const assignedOrders = await orderCollection
      .find({ $or: orMatch })
      .sort({ createdAt: -1 })
      .toArray();

    // Collect client names if missing
    const clientIds = [...new Set(assignedOrders.map((o) => o.clientId).filter(Boolean))];
    const clientDocs =
      clientIds.length > 0
        ? await clientCollection
            .find({
              _id: {
                $in: clientIds.map((cId) =>
                  ObjectId.isValid(cId) ? new ObjectId(cId) : cId
                ),
              },
            })
            .project({ name: 1 })
            .toArray()
        : [];
    const clientMap = new Map(clientDocs.map((c) => [c._id.toString(), c.name]));

    // 3. Compute Metrics
    const totalProjects = assignedOrders.length;
    let completedProjects = 0;
    let activeProjects = 0;
    let cancelledProjects = 0;
    let pendingProjects = 0;

    let totalGrossRevenue = 0; // 1. Total Project Value (Price/Budget)
    let totalCollectedRevenue = 0; // 2. Actual Collected Amount (Paid)
    let totalCosts = 0; // Total Costs spent on projects
    let totalRewardPoints = 0;
    let totalTasks = 0;
    let completedTasks = 0;

    const formattedProjects = assignedOrders.map((order) => {
      const statusLower = (order.status || "pending").toLowerCase();
      const isCompleted = statusLower === "completed";
      const isCancelled = statusLower === "cancelled";
      const isActive = ["processing", "active", "in progress"].includes(statusLower);
      const isPending = statusLower === "pending";

      if (isCompleted) completedProjects++;
      else if (isActive) activeProjects++;
      else if (isCancelled) cancelledProjects++;
      else pendingProjects++;

      const price = Number(order.servicePrice || order.price) || 0;
      const amount = Number(order.amount) || 0;
      const cost = Number(order.totalCost) || 0;
      const profit = amount - cost;

      if (!isCancelled) {
        totalGrossRevenue += price;
      }
      totalCollectedRevenue += amount;
      totalCosts += cost;
      totalRewardPoints += Number(order.rewardPoints) || 0;

      const tasksList = Array.isArray(order.tasks) ? order.tasks : [];
      totalTasks += tasksList.length;
      completedTasks += tasksList.filter((t) => t.completed).length;

      // Resolved client name
      const clientName =
        order.client ||
        (order.clientId ? clientMap.get(order.clientId.toString()) : null) ||
        "Client";

      return {
        _id: order._id,
        orderId: order.orderId || (order._id ? order._id.toString().slice(-6) : "N/A"),
        serviceName: order.serviceName || order.service || "Service",
        planName: order.planName || "Custom Plan",
        client: clientName,
        price,
        amount,
        cost,
        profit,
        status: order.status || "Pending",
        payment: order.payment || "Pending",
        deadline: order.deadline || null,
        createdAt: order.createdAt || null,
        updatedAt: order.updatedAt || null,
        tasksCount: tasksList.length,
        completedTasksCount: tasksList.filter((t) => t.completed).length,
      };
    });

    // 4. Lifetime Points from PointsLogs if available
    let pointsLogTotal = 0;
    try {
      const logs = await pointsLogCollection
        .find({
          $or: [
            { userId: userIdStr },
            ...(targetEmail
              ? [{ userEmail: { $regex: new RegExp(`^${targetEmail}$`, "i") } }]
              : []),
          ],
        })
        .toArray();
      pointsLogTotal = logs.reduce((acc, log) => acc + (Number(log.points) || 0), 0);
    } catch (e) {
      // PointsLogs fallback
    }

    const netProfit = totalCollectedRevenue - totalCosts;
    const grossProfit = totalGrossRevenue - totalCosts;
    const completionRate =
      totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0;

    return res.status(200).json({
      success: true,
      member: {
        _id: userIdStr,
        name: memberName || "Team Member",
        email: targetEmail,
        role: userDoc?.role || teamDoc?.role || "member",
        profilePic:
          userDoc?.photoURL ||
          userDoc?.profilePic ||
          teamDoc?.profilePic ||
          teamDoc?.avatar ||
          null,
        createdAt: userDoc?.createdAt || teamDoc?.createdAt || null,
        permissions: userDoc?.permissions || [],
      },
      stats: {
        totalProjects,
        completedProjects,
        activeProjects,
        pendingProjects,
        cancelledProjects,
        completionRate,

        // 3 Revenue aspects:
        totalGrossRevenue, // 1. Total Deal/Budget value
        totalCollectedRevenue, // 2. Total Paid/Collected from clients
        totalCosts, // Total Costs spent on projects
        netProfit, // 3. Collected - Cost
        grossProfit, // Gross Value - Cost

        totalRewardPoints: pointsLogTotal || totalRewardPoints,
        totalTasks,
        completedTasks,
      },
      projects: formattedProjects,
    });
  } catch (error) {
    console.error("Get member profile stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch member analytics",
      error: error.message,
    });
  }
};
