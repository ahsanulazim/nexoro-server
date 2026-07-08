import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
  cors: { origin: allowedOrigin, credentials: true },
});

const getReceiverSocketId = (userId) => {
  return userScoketMap[userId];
};

const userScoketMap = {};

io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;

  console.log("user connected", userId);

  if (userId) {
    userScoketMap[userId] = socket.id;
  }

  io.emit("getOnlineUsers", Object.keys(userScoketMap));

  socket.on("disconnect", () => {
    console.log("user disconnected", userId);

    if (userId) {
      delete userScoketMap[userId];
    }
    io.emit("getOnlineUsers", Object.keys(userScoketMap));
  });
});

export { app, server, io, getReceiverSocketId };
