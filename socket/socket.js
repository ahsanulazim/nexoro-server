import express from "express";
import http from "http";
import { Server } from "socket.io";
import axios from "axios";
import client from "../config/db.js";
import admin from "../admin/firebase.config.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";
import { fbApi } from "../utils/axios/fbApi.js";
import {
  formatMetaAttachmentPayload,
  formatMetaAttachmentContent,
  formatWhatsAppMediaPayload,
  sendMetaMessage,
} from "../utils/channelMediaAdapter.js";
import { markWhatsAppMessageAsRead } from "../controllers/whatsappController.js";

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
  cors: { origin: allowedOrigin, credentials: true },
});

const ADMIN_ROOM = "admin_global_room";
const onlineCustomers = new Set();

const userCollection = client.db("nexoro").collection("Users");
const conversationCollection = client.db("nexoro").collection("Conversations");

//Connection middleware with mongodb role check (customer vs admin)
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error("Unauthorized: No token provided"));
    }
    const decodedToken = await admin.auth().verifyIdToken(token);
    const email = decodedToken.email;

    //role check from mongodb users collection
    const user = await userCollection.findOne({ email });

    if (!user || !["admin", "customer", "member"].includes(user.role)) {
      return next(new Error("Unauthorized: Invalid user role"));
    }

    socket.user = user;

    next();
  } catch (error) {
    console.log("Socket connection error:", error);
    next(new Error("Unauthorized: Invalid token"));
  }
});

//Connection open
io.on("connection", async (socket) => {
  const { email, role, _id, name, userName, avatar, phone } = socket.user;
  const isStaff = role === "admin" || role === "member";

  console.log(`A user connected: ${email} (${role}), ID: ${_id} `);
  const msgCollection = client.db("nexoro").collection("Messages");

  try {
    await userCollection.updateOne({ _id }, { $set: { online: true, isOnline: true } });

    if (role === "customer") {
      onlineCustomers.add(_id);
      io.to(ADMIN_ROOM).emit("customerStatus", {
        userId: _id,
        isOnline: true,
      });
    }
  } catch (error) {
    console.log("Error in setting user online:", error);
  }

  // Everyone joins their own personal room by ID for targeted notifications
  socket.join(_id.toString());
  socket.join(`user_${_id}`);

  if (isStaff) {
    socket.join(ADMIN_ROOM);
    socket.emit("getOnlineCustomers", Array.from(onlineCustomers));

    try {
      const unreadCount = [
        {
          $match: { isRead: false, senderRole: "customer" },
        },
        {
          $group: { _id: "$roomId", count: { $sum: 1 } },
        },
      ];

      const unreadResults = await msgCollection
        .aggregate(unreadCount)
        .toArray();

      const countsObj = {};
      unreadResults.forEach((item) => {
        countsObj[item._id] = item.count;
      });

      socket.emit("initialUnreadCounts", countsObj);
    } catch (error) {
      console.log("Error in getting unread messages:", error);
    }

    // Send initial real-time dashboard stats to admin on connect
    if (role === "admin") {
      try {
        const { getLatestDashboardStats } = await import("../utils/dashboardHelper.js");
        const initialStats = await getLatestDashboardStats();
        socket.emit("dashboardStatsUpdate", initialStats);
      } catch (error) {
        console.log("Error in sending initial dashboard stats:", error);
      }
    }
  } else {
    socket.join(`room_${_id}`);
  }

  socket.on("sendMessage", async (data) => {
    try {
      const {
        text,
        receiverId,
        replyTo,
        roomId: clientRoomId,
        attachments: rawAttachments,
      } = data;

      // Determine roomId
      let roomId = clientRoomId;
      if (!roomId) {
        roomId = isStaff ? `room_${receiverId}` : `room_${_id}`;
      }

      // Determine platform
      let platform = "web";
      if (roomId.startsWith("fb_")) platform = "facebook";
      else if (roomId.startsWith("ig_")) platform = "instagram";
      else if (roomId.startsWith("wa_")) platform = "whatsapp";

      const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];

      // If staff is sending to Meta / WhatsApp, dispatch via external APIs
      let externalMetaId = null;
      let sendFailure = null;
      if (isStaff) {
        const recipientId = receiverId || roomId.replace(/^(fb_|ig_|wa_)/, "");

        if (platform === "facebook" || platform === "instagram") {
          // Send text if provided
          if (text && text.trim() !== "") {
            const metaRes = await sendMetaMessage(recipientId, { text });
            if (metaRes.success) {
              externalMetaId = metaRes.messageId;
            } else if (metaRes.code === "OUTSIDE_ALLOWED_WINDOW") {
              socket.emit("messageDeliveryFailed", {
                roomId,
                code: "OUTSIDE_ALLOWED_WINDOW",
                message: metaRes.message,
              });
              return;
            }
          }

          // Send attachments
          for (const att of attachments) {
            const content = formatMetaAttachmentContent(att);
            const metaAttRes = await sendMetaMessage(recipientId, content);
            if (metaAttRes.success) {
              if (!externalMetaId) externalMetaId = metaAttRes.messageId;
            } else if (metaAttRes.code === "OUTSIDE_ALLOWED_WINDOW") {
              socket.emit("messageDeliveryFailed", {
                roomId,
                code: "OUTSIDE_ALLOWED_WINDOW",
                message: metaAttRes.message,
              });
              return;
            }
          }
        } else if (platform === "whatsapp") {
          const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
          const accessToken =
            process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
          if (!phoneNumberId) {
            socket.emit("messageDeliveryFailed", {
              roomId,
              code: "WHATSAPP_CONFIG_MISSING",
              message: "WHATSAPP_PHONE_NUMBER_ID is not configured in backend .env",
            });
            return;
          }

          try {
            // Find target recipient: prefer phone if available, else BSUID
            let targetRecipient = recipientId;
            if (!targetRecipient || targetRecipient === "admin" || targetRecipient === "undefined") {
              targetRecipient = roomId.replace(/^wa_/, "");
            }

            const conv = await conversationCollection.findOne({ roomId });
            if (conv?.customer) {
              if (conv.customer.phone && /^\+?[0-9]+$/.test(conv.customer.phone)) {
                targetRecipient = conv.customer.phone;
              } else if (conv.customer.bsuid) {
                targetRecipient = conv.customer.bsuid;
              } else if (conv.platformId && conv.platformId !== "undefined") {
                targetRecipient = conv.platformId;
              }
            }

            const isPhone = /^\+?[0-9]+$/.test(String(targetRecipient).trim());
            const waTarget = isPhone
              ? String(targetRecipient).replace(/[^0-9]/g, "")
              : String(targetRecipient).trim();

            if (text && text.trim() !== "" && attachments.length === 0) {
              const waTextPayload = {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                type: "text",
                text: { preview_url: false, body: text },
              };
              if (isPhone) {
                waTextPayload.to = waTarget;
              } else {
                waTextPayload.recipient = waTarget;
              }

              const waRes = await axios.post(
                `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
                waTextPayload,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              externalMetaId = waRes.data?.messages?.[0]?.id;
            }

            for (let i = 0; i < attachments.length; i++) {
              const att = attachments[i];
              const caption = i === 0 ? text : "";
              const payload = formatWhatsAppMediaPayload(targetRecipient, att, caption);
              const waMediaRes = await axios.post(
                `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
                payload,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              if (!externalMetaId) externalMetaId = waMediaRes.data?.messages?.[0]?.id;
            }
          } catch (waErr) {
            const errData = waErr.response?.data?.error;
            const errCode = errData?.code;
            const errMsg = errData?.message || waErr.message;
            console.error(
              "WhatsApp Cloud API send error:",
              errData || waErr.message
            );

            const isWindowExpired = errCode === 131047;
            const failureReason = isWindowExpired
              ? "WhatsApp Policy: 24-hour response window has expired. Standard messages cannot be sent until customer replies."
              : `WhatsApp send failed: ${errMsg}`;

            socket.emit("messageDeliveryFailed", {
              roomId,
              code: isWindowExpired ? "OUTSIDE_ALLOWED_WINDOW" : "WHATSAPP_API_ERROR",
              message: failureReason,
            });

            sendFailure = {
              status: "failed",
              reason: failureReason,
            };
          }
        }
      }

      // Compute last message text
      let lastMessageText = text;
      if ((!text || text.trim() === "") && attachments.length > 0) {
        const imgCount = attachments.filter((a) => a.category === "image").length;
        const vidCount = attachments.filter((a) => a.category === "video").length;
        const audCount = attachments.filter((a) => a.category === "audio").length;

        if (imgCount === 1) lastMessageText = "📷 Sent a photo";
        else if (imgCount > 1) lastMessageText = `📷 Sent ${imgCount} photos`;
        else if (vidCount > 0) lastMessageText = "🎥 Sent a video";
        else if (audCount > 0) lastMessageText = "🎤 Voice message";
        else lastMessageText = `📁 Sent an attachment: ${attachments[0]?.originalName || "file"}`;
      }

      const now = new Date();
      const messageData = {
        roomId,
        platform,
        senderId: _id,
        senderRole: role,
        receiverId: isStaff
          ? receiverId || roomId.replace(/^(fb_|ig_|wa_)/, "")
          : "admin",
        text,
        attachments,
        isRead: false,
        deliveryStatus: sendFailure
          ? "failed"
          : externalMetaId
          ? "sent"
          : "sent",
        failureReason: sendFailure?.reason || null,
        externalMetaId,
        metaMessageId: externalMetaId,
        replyTo: replyTo
          ? {
              messageId: replyTo.messageId,
              senderId: replyTo.senderId,
              text: replyTo.text || "",
              attachments: replyTo.attachments || [],
            }
          : null,
        createdAt: now,
      };

      // save to db
      await msgCollection.insertOne(messageData);

      const updateDoc = {
        $set: {
          lastMessage: lastMessageText,
          updatedAt: now,
          platform,
          ...(role === "customer"
            ? {
                customer: {
                  _id,
                  id: _id,
                  name: name || userName || email || "Customer",
                  userName: userName || name || email || "Customer",
                  email: email || null,
                  phone: phone || null,
                  avatar: avatar || null,
                },
              }
            : {}),
        },
        $setOnInsert: {
          customerId: isStaff ? receiverId : _id,
          createdAt: now,
          ...(isStaff ? { unreadCount: 0 } : {}),
        },
        ...(role === "customer" ? { $inc: { unreadCount: 1 } } : {}),
      };

      const convRes = await conversationCollection.findOneAndUpdate(
        { roomId },
        updateDoc,
        { upsert: true, returnDocument: "after" }
      );
      const updatedConv = convRes?.value ?? convRes;

      io.to(roomId).emit("receiveMessage", messageData);
      io.to(ADMIN_ROOM).emit("receiveMessage", messageData);

      if (role === "customer") {
        const unreadCount =
          typeof updatedConv?.unreadCount === "number"
            ? updatedConv.unreadCount
            : await msgCollection.countDocuments({
                roomId,
                isRead: false,
                senderRole: "customer",
              });

        io.to(ADMIN_ROOM).emit("newConversationUpdate", {
          roomId,
          lastMessage: lastMessageText,
          updatedAt: now,
          customerId: _id,
          platform,
          customer: updatedConv?.customer,
          unreadCount,
        });

        io.to(ADMIN_ROOM).emit("updateUnreadCount", { roomId, count: unreadCount });

        // Create message notification for staff (admin & members)
        await createAndSendNotification({
          type: "new_message",
          title: "New Message Received",
          message: `You received a message from ${email || "Customer"}: "${text.length > 40 ? text.substring(0, 37) + '...' : text}"`,
          link: `/dashboard/inbox/web/${_id}`,
          recipientRole: "staff",
        });
      } else {
        io.to(ADMIN_ROOM).emit("newConversationUpdate", {
          roomId,
          lastMessage: lastMessageText,
          updatedAt: now,
          customerId: receiverId,
          platform,
          customer: updatedConv?.customer,
        });
      }
    } catch (sendErr) {
      console.error("Error in socket sendMessage:", sendErr);
    }
  });

  //mark messages as read
  socket.on("markAsRead", async ({ roomId }) => {
    if (!roomId) return;
    await Promise.all([
      msgCollection.updateMany(
        { roomId, isRead: false, senderId: { $ne: _id } },
        { $set: { isRead: true } }
      ),
      isStaff
        ? conversationCollection.updateOne(
            { roomId },
            { $set: { unreadCount: 0 } }
          )
        : Promise.resolve(),
    ]);
    io.to(roomId).emit("messagesRead", { roomId });

    if (isStaff) {
      io.to(ADMIN_ROOM).emit("updateUnreadCount", { roomId, count: 0 });

      // If staff is reading a WhatsApp conversation, notify WhatsApp Cloud API for blue ticks
      if (roomId.startsWith("wa_") || String(roomId).includes("wa_")) {
        try {
          const unreadWaMsgs = await msgCollection
            .find({
              roomId,
              senderRole: "customer",
              metaMessageId: { $exists: true, $ne: null },
            })
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

          for (const waMsg of unreadWaMsgs) {
            if (waMsg.metaMessageId) {
              markWhatsAppMessageAsRead(waMsg.metaMessageId);
            }
          }
        } catch (markErr) {
          console.error("Error in markWhatsAppMessageAsRead:", markErr);
        }
      }
    }
  });

  socket.on("joinRoom", ({ roomId }) => {
    if (!roomId) return;
    const currentRooms = Array.from(socket.rooms);
    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");

    currentRooms.forEach((room) => {
      if (
        room !== socket.id &&
        room !== ADMIN_ROOM &&
        room !== `room_${_id}` &&
        room !== _id.toString() &&
        room !== `user_${_id}`
      ) {
        socket.leave(room);
      }
    });

    socket.join(roomId);
    socket.join(cleanId);
    socket.join(`fb_${cleanId}`);
    socket.join(`ig_${cleanId}`);
    socket.join(`wa_${cleanId}`);
    socket.join(`room_${cleanId}`);
    console.log(`User joined rooms for: ${roomId}`);
  });

  socket.on("disconnect", async () => {
    console.log(`user disconnected: ${_id}`);

    try {
      await userCollection.updateOne({ _id }, { $set: { online: false, isOnline: false } });

      if (role === "customer") {
        onlineCustomers.delete(_id);
        io.to(ADMIN_ROOM).emit("customerStatus", {
          userId: _id,
          isOnline: false,
        });
      }
    } catch (error) {
      console.log("Error in setting user offline:", error);
    }
  });
});

export { app, server, io };
