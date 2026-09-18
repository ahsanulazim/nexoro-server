import client from "../config/db.js";
import { io } from "../socket/socket.js";

const notificationCollection = client.db("nexoro").collection("Notifications");

// Initialize TTL index for 60 days automatic cleanup on startup
export const initNotificationTTL = async () => {
  try {
    // 60 days in seconds = 60 * 24 * 60 * 60 = 5184000
    await notificationCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 5184000 }
    );
    console.log("MongoDB Notification TTL index initialized (60 days expiration).");
  } catch (error) {
    console.error("Error creating TTL index on Notifications collection:", error);
  }
};

// Helper function to create notification in DB and emit to Socket.io
export const createAndSendNotification = async ({
  type,
  title,
  message,
  link,
  recipientId = null,
  recipientRole = null,
}) => {
  try {
    const notification = {
      type,
      title,
      message,
      link,
      recipientId: recipientId ? recipientId.toString() : null,
      recipientRole: recipientRole || (recipientId ? null : "admin"),
      isRead: false,
      createdAt: new Date(),
    };

    const result = await notificationCollection.insertOne(notification);
    const enrichedNotification = {
      _id: result.insertedId.toString(),
      ...notification,
    };

    // If targeted to a specific user/member
    if (recipientId) {
      const targetStr = recipientId.toString();
      io.to(targetStr).emit("newNotification", enrichedNotification);
      io.to(`user_${targetStr}`).emit("newNotification", enrichedNotification);
    }

    // If targeted to admin, staff, or broadcast
    if (
      notification.recipientRole === "admin" ||
      notification.recipientRole === "staff" ||
      notification.recipientRole === "all"
    ) {
      io.to("admin_global_room").emit("newNotification", enrichedNotification);
    }

    return enrichedNotification;
  } catch (error) {
    console.error("Failed to create/send notification:", error);
    return null;
  }
};

