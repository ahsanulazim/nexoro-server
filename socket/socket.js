import express from "express";
import http from "http";
import { Server } from "socket.io";
import client from "../config/db.js";
import admin from "../admin/firebase.config.js";

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
  cors: { origin: allowedOrigin, credentials: true },
});

const ADMIN_ROOM = "admin_global_room";
const onlineCustomers = new Set();

const userCollection = client.db("nexoro").collection("Users");
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

    if (!user || !["admin", "customer"].includes(user.role)) {
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
  const { email, role, _id } = socket.user;

  console.log(`A user connected: ${email} (${role}), ID: ${_id} `);
  const msgCollection = client.db("nexoro").collection("Messages");

  try {
    await userCollection.updateOne({ _id }, { $set: { online: true } });

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

  if (role === "admin") {
    socket.join(ADMIN_ROOM);
    socket.join(_id);
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
  } else {
    socket.join(`room_${_id}`);
  }

  socket.on("sendMessage", async (data) => {
    const { text, receiverId, replyTo } = data;

    const roomId = role === "admin" ? `room_${receiverId}` : `room_${_id}`;

    const messageData = {
      roomId,
      senderId: _id,
      senderRole: role,
      receiverId,
      text,
      attachments: [],
      isRead: false,
      replyTo: replyTo
        ? {
            messageId: replyTo.messageId,
            senderId: replyTo.senderId,
            text: replyTo.text || "",
            attachments: replyTo.attachments || [],
          }
        : null,
      createdAt: new Date(),
    };

    //save to db
    await msgCollection.insertOne(messageData);

    const conversationCollection = client
      .db("nexoro")
      .collection("Conversations");
    await conversationCollection.updateOne(
      { roomId },
      {
        $set: {
          lastMessage: text,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          customerId: role === "admin" ? receiverId : _id,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    io.to(roomId).emit("receiveMessage", messageData);

    if (role === "customer") {
      io.to(ADMIN_ROOM).emit("newConversationUpdate", {
        roomId,
        lastMessage: text,
        customerId: _id,
      });

      const unreadCount = await msgCollection.countDocuments({
        roomId,
        isRead: false,
        senderRole: "customer",
      });
      io.to(ADMIN_ROOM).emit("updateUnreadCount", { roomId, count: unreadCount });
    }
  });

  //mark messages as read
  socket.on("markAsRead", async ({ roomId }) => {
    await msgCollection.updateMany(
      { roomId, senderId: { $ne: _id } },
      { $set: { isRead: true } },
    );
    io.to(roomId).emit("messagesRead", { roomId });

    if (role === "admin") {
      io.to(ADMIN_ROOM).emit("updateUnreadCount", { roomId, count: 0 });
    }
  });

  socket.on("joinRoom", ({ roomId }) => {
    const currentRooms = Array.from(socket.rooms);
    currentRooms.forEach((room) => {
      if (room !== socket.id && room !== ADMIN_ROOM && room !== `room_${_id}`) {
        socket.leave(room);
      }
    });

    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });

  socket.on("disconnect", async () => {
    console.log(`user disconnected: ${_id}`);

    try {
      await userCollection.updateOne({ _id }, { $set: { isOnline: false } });

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
