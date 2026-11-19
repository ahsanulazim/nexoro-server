import admin from "../admin/firebase.config.js";
import client from "../config/db.js";
import { DEFAULT_MEMBER_PERMISSIONS } from "../config/permissions.js";

const userCollection = client.db("nexoro").collection("Users");

/**
 * Middleware factory to guard routes by module permission.
 * - Admin always has full access.
 * - Members must have the required permission in their `permissions` array
 *   (or in `DEFAULT_MEMBER_PERMISSIONS` if none has been explicitly set yet).
 * - Customers or unauthenticated users are rejected.
 *
 * @param {string} requiredPermission - The permission key (e.g. 'orders', 'expenses')
 */
export const verifyPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      let email = req.user?.email;

      // If verifyId hasn't run yet, verify token from authorization header
      if (!email) {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
          return res
            .status(401)
            .json({ success: false, message: "Unauthorized access: Token missing" });
        }

        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        email = decodedToken.email;
      }

      if (!email) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized: Invalid user context" });
      }

      // Fetch user from MongoDB
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User account not found" });
      }

      req.mongoUser = user;

      // 1. Admins have access to everything
      if (user.role === "admin") {
        return next();
      }

      // 2. Members are checked against their permissions
      if (user.role === "member") {
        const effectivePermissions = Array.isArray(user.permissions)
          ? user.permissions
          : DEFAULT_MEMBER_PERMISSIONS;

        if (effectivePermissions.includes(requiredPermission)) {
          return next();
        }

        return res.status(403).json({
          success: false,
          message: `Forbidden: You do not have permission for '${requiredPermission}'`,
          requiredPermission,
        });
      }

      // 3. Any other role (e.g. customer) is denied
      return res.status(403).json({
        success: false,
        message: "Forbidden: Member or Admin privilege required",
      });
    } catch (error) {
      console.error("verifyPermission error:", error);
      return res
        .status(403)
        .json({ success: false, message: "Invalid or expired token" });
    }
  };
};
