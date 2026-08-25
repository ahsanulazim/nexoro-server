import { ObjectId } from "mongodb";
import client from "../config/db.js";

const notificationCollection = client.db("nexoro").collection("Notifications");

// Get all notifications (paginated) + unread count
export const getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalNotifications = await notificationCollection.countDocuments();
    const unreadCount = await notificationCollection.countDocuments({ isRead: false });

    const notifications = await notificationCollection
      .find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.status(200).json({
      success: true,
      notifications,
      unreadCount,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalNotifications / limit),
        totalNotifications,
      },
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

// Mark single notification as read
export const markAsRead = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await notificationCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isRead: true } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: "Notification not found or already read" });
    }

    res.status(200).json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark notification as read error:", error);
    res.status(500).json({ success: false, message: "Failed to update notification" });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    await notificationCollection.updateMany(
      { isRead: false },
      { $set: { isRead: true } }
    );
    res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all notifications as read error:", error);
    res.status(500).json({ success: false, message: "Failed to update notifications" });
  }
};
