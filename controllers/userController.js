import client from "../config/db.js";
import admin from "../admin/firebase.config.js";
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
  const { name, email } = req.body;
  const uid = req.user?.uid;
  const emailVerified = req.user?.email_verified || false;
  // Check if sign-in provider is Google
  const role = "customer";
  const createdAt = new Date();
  const newUser = {
    name,
    email,
    uid,
    role,
    emailVerified,
    createdAt,
  };
  try {
    const existingUser = await userCollection.findOne({ email });
    if (existingUser) {
      return res.status(200).send({
        success: false,
        message: "User already exists",
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
    const members = await userCollection.find({ role: "member" }).toArray();
    res.status(200).json(members);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch members", error });
  }
};

// Get assignable users (registered members and admins)
export const getAssignableUsers = async (req, res) => {
  try {
    const users = await userCollection
      .find({ role: { $in: ["member", "admin"] } })
      .project({ name: 1, email: 1, role: 1, uid: 1 })
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

  if (!decodedToken || !decodedToken.uid) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const uid = decodedToken.uid;
  const updatedData = req.body;

  try {
    const result = await userCollection.updateOne(
      { uid },
      { $set: updatedData },
    );
    if (result.modifiedCount > 0) {
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
