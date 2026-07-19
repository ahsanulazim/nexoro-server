import cloudinary from "../config/cloudinary.js";
import client from "../config/db.js";
import { io } from "../socket/socket.js";
import { imageOptimizer } from "../utils/imageOptimizer.js";

const msgCollection = client.db("nexoro").collection("Messages");
const userCollection = client.db("nexoro").collection("Users");
const conversationCollection = client.db("nexoro").collection("Conversations");

export const sendMessage = async (req, res) => {
  try {
    const { text, receiverId, replyTo } = req.body;

    const decodedToken = req.user;

    if (!req.file && (!text || text.trim() === "")) {
      return res
        .status(400)
        .json({ success: false, message: "Message cannot be empty" });
    }

    const senderUser = await userCollection.findOne({
      email: decodedToken.email,
    });

    const roomId =
      senderUser.role === "admin"
        ? `room_${receiverId}`
        : `room_${senderUser._id}`;
    let attachments = [];

    if (req.file) {
      const isImage =
        req.file.mimetype && req.file.mimetype.startsWith("image/");
      const thumbnailUrl = isImage
        ? imageOptimizer(req.file.path, 300, 300)
        : "";

      attachments.push({
        type: isImage ? "image" : req.file.mimetype,
        url: req.file.path,
        thumbnailUrl,
        publicId: req.file.filename,
        originalName: req.file.originalname,
      });
    }

    let replyToData = null;
    if (replyTo) {
      try {
        replyToData =
          typeof replyTo === "string" ? JSON.parse(replyTo) : replyTo;
      } catch (error) {
        console.log("error while parsing replyTo", error);
      }
    }

    const msgData = {
      roomId,
      senderId: senderUser._id,
      senderRole: senderUser.role,
      receiverId,
      text,
      attachments,
      isRead: false,
      replyTo: replyToData
        ? {
            messageId: replyToData.messageId,
            senderId: replyToData.senderId,
            text: replyToData.text || "",
            attachments: replyToData.attachments || [],
          }
        : null,
      createdAt: new Date(),
    };

    await msgCollection.insertOne(msgData);
    console.log("Message sent successfully", msgData);

    let lastMessageText = text;
    if (req.file && (!text || text.trim() === "")) {
      lastMessageText = `Sent an attachment: ${req.file.originalname}`;
    }

    await conversationCollection.updateOne(
      { roomId },
      {
        $set: { lastMessage: lastMessageText, updatedAt: new Date() },
        $setOnInsert: {
          customerId: senderUser.role === "admin" ? receiverId : senderUser._id,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    io.to(roomId).emit("receiveMessage", msgData);

    if (senderUser.role === "customer") {
      io.to("admin_global_room").emit("newConversationUpdate", {
        roomId,
        lastMessage: lastMessageText,
        customerId: senderUser._id,
      });

      const unreadCount = await msgCollection.countDocuments({
        roomId,
        isRead: false,
        senderRole: "customer",
      });
      io.to("admin_global_room").emit("updateUnreadCount", {
        roomId,
        count: unreadCount,
      });
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: msgData,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { roomId } = req.query;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }

    const totalMessages = await msgCollection.countDocuments({ roomId });
    const totalPages = Math.ceil(totalMessages / limit);
    if (page > totalPages) {
      return res.status(400).json({
        success: false,
        message: "Page number is greater than total pages",
      });
    }

    const decodedToken = req.user;

    const user = await userCollection.findOne({
      email: decodedToken.email,
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const messages = await msgCollection
      .find({ roomId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const sortedMessages = messages.reverse();

    res.status(200).json({
      success: true,
      message: "Messages fetched successfully",
      data: sortedMessages,
      pagination: {
        page,
        limit,
        totalMessages,
        totalPages,
        hasMore: page < totalPages,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getSidebarConversations = async (req, res) => {
  try {
    const conversations = await conversationCollection
      .aggregate([
        { $sort: { updatedAt: -1 } },
        {
          $lookup: {
            from: "Users",
            localField: "customerId",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: "$customer" },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      message: "Conversations fetched successfully",
      data: conversations,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteConversation = async (req, res) => {
  try {
    const { roomId } = req.query;

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }

    // Find all messages in the room to check for attachments
    const messages = await msgCollection.find({ roomId }).toArray();

    // Iterate through messages and delete attachments from Cloudinary
    for (const message of messages) {
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.publicId) {
            try {
              await cloudinary.uploader.destroy(attachment.publicId);
            } catch (cloudinaryError) {
              console.error(
                "Error deleting file from Cloudinary:",
                cloudinaryError,
              );
            }
          }
        }
      }
    }

    // Delete all messages in the room
    await msgCollection.deleteMany({ roomId });

    // Delete the conversation document
    await conversationCollection.deleteOne({ roomId });

    // Emit socket event to notify clients
    io.to(roomId).emit("conversationDeleted", { roomId });

    res.status(200).json({
      success: true,
      message: "Conversation deleted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
