import { ObjectId } from "mongodb";
import client from "../config/db.js";

const notificationCollection = client.db("nexoro").collection("Notifications");
const userCollection = client.db("nexoro").collection("Users");

const getUserNotificationFilter = (user) => {
  const userIdStr = user._id.toString();
  if (user.role === "admin") {
    return {
      $or: [
        { recipientRole: { $in: ["admin", "staff", "all"] } },
        { recipientId: user._id },
        { recipientId: userIdStr },
        { recipientRole: { $exists: false }, recipientId: { $exists: false } },
        { recipientRole: null, recipientId: null },
      ],
    };
  } else if (user.role === "member") {
    return {
      $or: [
        { recipientId: user._id },
        { recipientId: userIdStr },
        { recipientRole: { $in: ["member", "staff", "all"] } },
      ],
    };
  } else {
    // Customer
    return {
      $or: [
        { recipientId: user._id },
        { recipientId: userIdStr },
      ],
    };
  }
};

// Get all notifications (paginated) + unread count
export const getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const userEmail = req.user?.email;
    const user = await userCollection.findOne({ email: userEmail });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const filter = getUserNotificationFilter(user);

    const totalNotifications = await notificationCollection.countDocuments(filter);
    const unreadCount = await notificationCollection.countDocuments({
      ...filter,
      isRead: false,
    });

    const notifications = await notificationCollection
      .find(filter)
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
        limit,
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
    const userEmail = req.user?.email;
    const user = await userCollection.findOne({ email: userEmail });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const accessFilter = getUserNotificationFilter(user);

    const result = await notificationCollection.updateOne(
      { _id: new ObjectId(id), ...accessFilter },
      { $set: { isRead: true } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
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
    const userEmail = req.user?.email;
    const user = await userCollection.findOne({ email: userEmail });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const accessFilter = getUserNotificationFilter(user);

    await notificationCollection.updateMany(
      { ...accessFilter, isRead: false },
      { $set: { isRead: true } }
    );
    res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all notifications as read error:", error);
    res.status(500).json({ success: false, message: "Failed to update notifications" });
  }
};
