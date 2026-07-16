import cloudinary from "../config/cloudinary.js";
import client from "../config/db.js";
import { io } from "../socket/socket.js";

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
      const uploadStream = () => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "chat_attachments",
              resource_type: "auto",
            },
            (error, result) => {
              if (error) {
                console.log(error);
                reject(error);
              } else {
                resolve(result);
              }
            },
          );
          stream.end(req.file.buffer);
        });
      };

      const cloudinaryResult = await uploadStream();
      attachments.push({
        type: cloudinaryResult.resource_type,
        url: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
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
      io.to("admin_global_room").emit("updateUnreadCount", { roomId, count: unreadCount });
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

    console.log("room id", roomId);

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
      .sort({ createdAt: 1 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Messages fetched successfully",
      data: messages,
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
