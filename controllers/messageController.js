import { ObjectId } from "mongodb";
import cloudinary from "../config/cloudinary.js";
import client from "../config/db.js";
import { io } from "../socket/socket.js";
import { imageOptimizer } from "../utils/imageOptimizer.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";
import { convertToBDT } from "../utils/currencyHelper.js";
import { getNextOrderId } from "./orderController.js";
import { fbApi } from "../utils/axios/fbApi.js";
import {
  validateAttachmentForChannel,
  formatMetaAttachmentPayload,
  formatMetaAttachmentContent,
  formatWhatsAppMediaPayload,
  categorizeMime,
  sendMetaMessage,
} from "../utils/channelMediaAdapter.js";
import axios from "axios";

const msgCollection = client.db("nexoro").collection("Messages");
const userCollection = client.db("nexoro").collection("Users");
const conversationCollection = client.db("nexoro").collection("Conversations");
const clientCollection = client.db("nexoro").collection("Clients");
const orderCollection = client.db("nexoro").collection("Orders");
const serviceCollection = client.db("nexoro").collection("Services");

const EMAIL_EXTRACT_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const BD_PHONE_REGEX = /(?:\+?880|0)1[3-9]\d{8}\b/g;
const INTL_PHONE_REGEX = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;

const isPlaceholderClientEmail = (email) =>
  !email || String(email).toLowerCase().endsWith("@client.nexoro.local");

/**
 * Helper: Scan conversation messages to automatically extract customer Email & Phone
 */
const extractContactInfoFromMessages = (messages = [], roomId = "", platform = "web") => {
  let detectedEmail = null;
  let detectedPhone = null;

  const cleanRoom = String(roomId || "").replace(/^(fb_|ig_|wa_|room_)/, "");
  if (platform === "whatsapp" || String(roomId).startsWith("wa_")) {
    const waDigits = cleanRoom.replace(/[^0-9]/g, "");
    if (waDigits.length >= 8) {
      detectedPhone = `+${waDigits}`;
    }
  }

  // Scan messages from newest to oldest
  const customerMessages = [...messages]
    .filter((m) => m && m.text && (m.senderRole === "customer" || !m.isSystem))
    .reverse();

  for (const msg of customerMessages) {
    const text = String(msg.text || "");
    if (!detectedEmail) {
      const emailMatches = text.match(EMAIL_EXTRACT_REGEX);
      if (emailMatches && emailMatches.length > 0) {
        const validMatch = emailMatches.find((e) => !isPlaceholderClientEmail(e));
        if (validMatch) {
          detectedEmail = validMatch.toLowerCase().trim();
        }
      }
    }

    if (!detectedPhone) {
      const bdMatches = text.match(BD_PHONE_REGEX);
      if (bdMatches && bdMatches.length > 0) {
        detectedPhone = bdMatches[0].trim();
      } else {
        const intlMatches = text.match(INTL_PHONE_REGEX);
        if (intlMatches && intlMatches.length > 0) {
          const candidate = intlMatches.find(
            (p) => p.replace(/[^0-9]/g, "").length >= 10 && p.replace(/[^0-9]/g, "").length <= 15
          );
          if (candidate) {
            detectedPhone = candidate.trim();
          }
        }
      }
    }

    if (detectedEmail && detectedPhone) break;
  }

  return {
    email: detectedEmail,
    phone: detectedPhone,
  };
};

/**
 * Helper: Find matching Client in Clients collection by clientId, email, phone, or roomId
 */
const findMatchingClient = async ({ clientId, email, phone, roomId, platformId }) => {
  const orConditions = [];

  if (clientId && ObjectId.isValid(String(clientId))) {
    orConditions.push({ _id: new ObjectId(String(clientId)) });
  }

  if (email && !isPlaceholderClientEmail(email)) {
    const escaped = String(email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    orConditions.push({ email: { $regex: new RegExp(`^${escaped}$`, "i") } });
  }

  if (roomId) {
    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");
    orConditions.push({
      roomId: {
        $in: [roomId, cleanId, `fb_${cleanId}`, `ig_${cleanId}`, `wa_${cleanId}`, `room_${cleanId}`],
      },
    });
  }

  if (platformId) {
    orConditions.push({ platformId: String(platformId) });
  }

  if (phone) {
    const digits = String(phone).replace(/[^0-9]/g, "");
    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      orConditions.push({ phone: { $regex: last10 } });
    }
  }

  if (orConditions.length === 0) return null;

  return clientCollection.findOne({ $or: orConditions });
};

/**
 * 1. Upload Attachments Endpoint (Staged Upload Lifecycle)
 * Handles client validation, Cloudinary upload, thumbnail generation, and metadata normalization.
 */
export const uploadAttachments = async (req, res) => {
  try {
    const rawFiles = req.files || (req.file ? [req.file] : []);
    const files = Array.isArray(rawFiles)
      ? rawFiles
      : Object.values(rawFiles).flat();

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No files provided for upload" });
    }

    const { platform = "web" } = req.body;
    const uploadedAttachments = [];

    for (const file of files) {
      const validation = validateAttachmentForChannel(
        {
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        },
        platform
      );

      if (!validation.valid) {
        // Cleanup file from Cloudinary on validation failure
        if (file.filename) {
          try {
            await cloudinary.uploader.destroy(file.filename);
          } catch (delErr) {
            console.error("Cloudinary cleanup error:", delErr);
          }
        }
        return res
          .status(400)
          .json({ success: false, message: validation.error });
      }

      const category = validation.category;
      const isImage = category === "image";
      const thumbnailUrl = isImage
        ? imageOptimizer(file.path, 400, 400)
        : "";

      uploadedAttachments.push({
        id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        category,
        url: file.path,
        thumbnailUrl,
        publicId: file.filename,
        createdAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Attachments uploaded successfully",
      data: uploadedAttachments,
    });
  } catch (error) {
    console.error("Error in uploadAttachments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload attachment: " + error.message,
    });
  }
};

/**
 * 2. Send Message with Multiple Attachments & Channel Dispatch
 */
export const sendMessage = async (req, res) => {
  try {
    const {
      text = "",
      receiverId,
      roomId: customRoomId,
      replyTo,
      attachments: rawAttachments,
    } = req.body;
    const decodedToken = req.user;

    // 1. Gather all attachments from multipart upload and/or JSON body
    let attachments = [];

    // Parse pre-uploaded attachments if supplied
    if (rawAttachments) {
      try {
        const parsed =
          typeof rawAttachments === "string"
            ? JSON.parse(rawAttachments)
            : rawAttachments;
        if (Array.isArray(parsed)) {
          attachments.push(
            ...parsed.map((att) => ({
              id: att.id || att._id || `att_${Date.now()}`,
              originalName: att.originalName || att.name || "Attachment",
              mimeType: att.mimeType || att.type || "application/octet-stream",
              size: att.size || null,
              category:
                att.category ||
                categorizeMime(att.mimeType || att.type, att.originalName),
              url: att.url,
              thumbnailUrl:
                att.thumbnailUrl ||
                (att.category === "image"
                  ? imageOptimizer(att.url, 400, 400)
                  : ""),
              publicId: att.publicId || "",
              duration: att.duration || null,
              width: att.width || null,
              height: att.height || null,
              createdAt: att.createdAt ? new Date(att.createdAt) : new Date(),
            }))
          );
        }
      } catch (parseErr) {
        console.error("Error parsing attachments JSON:", parseErr);
      }
    }

    // Direct multipart file(s)
    const directFiles = [];
    if (req.file) directFiles.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) directFiles.push(...req.files);
      else if (typeof req.files === "object") {
        Object.values(req.files).forEach((fList) => {
          if (Array.isArray(fList)) directFiles.push(...fList);
        });
      }
    }

    for (const f of directFiles) {
      const category = categorizeMime(f.mimetype, f.originalname);
      const isImage = category === "image";
      attachments.push({
        id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        category,
        url: f.path,
        thumbnailUrl: isImage ? imageOptimizer(f.path, 400, 400) : "",
        publicId: f.filename,
        createdAt: new Date(),
      });
    }

    // Check message validity
    const hasText = text && text.trim() !== "";
    const hasAttachments = attachments.length > 0;

    if (!hasText && !hasAttachments) {
      return res
        .status(400)
        .json({ success: false, message: "Message cannot be empty" });
    }

    const senderUser = await userCollection.findOne({
      email: decodedToken.email,
    });

    if (!senderUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isStaff = senderUser.role === "admin" || senderUser.role === "member";
    let roomId = customRoomId;
    if (!roomId) {
      roomId = isStaff ? `room_${receiverId}` : `room_${senderUser._id}`;
    }

    // Determine platform from roomId
    let platform = "web";
    if (roomId.startsWith("fb_")) platform = "facebook";
    else if (roomId.startsWith("ig_")) platform = "instagram";
    else if (roomId.startsWith("wa_")) platform = "whatsapp";

    // Validate attachments for target platform
    for (const att of attachments) {
      const v = validateAttachmentForChannel(att, platform);
      if (!v.valid) {
        return res.status(400).json({ success: false, message: v.error });
      }
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

    // If staff is sending to external Meta / WhatsApp platforms, call external API
    let externalMetaId = null;
    if (isStaff) {
      const recipientId = receiverId || roomId.replace(/^(fb_|ig_|wa_)/, "");

      if (platform === "facebook" || platform === "instagram") {
        // Send text if provided
        if (hasText) {
          const metaRes = await sendMetaMessage(recipientId, { text });
          if (metaRes.success) {
            externalMetaId = metaRes.messageId;
          } else if (metaRes.code === "OUTSIDE_ALLOWED_WINDOW") {
            return res.status(400).json({
              success: false,
              code: "OUTSIDE_ALLOWED_WINDOW",
              message: metaRes.message,
            });
          }
        }

        // Send attachments via Meta Graph API
        for (const att of attachments) {
          const content = formatMetaAttachmentContent(att);
          const metaAttRes = await sendMetaMessage(recipientId, content);
          if (metaAttRes.success) {
            if (!externalMetaId) externalMetaId = metaAttRes.messageId;
          } else if (metaAttRes.code === "OUTSIDE_ALLOWED_WINDOW") {
            return res.status(400).json({
              success: false,
              code: "OUTSIDE_ALLOWED_WINDOW",
              message: metaAttRes.message,
            });
          }
        }
      } else if (platform === "whatsapp") {
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const accessToken =
          process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
        if (phoneNumberId) {
          try {
            const cleanPhone = recipientId.replace(/[^0-9]/g, "");

            // Send text message if text exists
            if (hasText && (!hasAttachments || attachments.length === 0)) {
              const waRes = await axios.post(
                `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
                {
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: cleanPhone,
                  type: "text",
                  text: { preview_url: false, body: text },
                },
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              externalMetaId = waRes.data?.messages?.[0]?.id;
            }

            // Send attachments to WhatsApp
            for (let idx = 0; idx < attachments.length; idx++) {
              const att = attachments[idx];
              // First attachment gets the text as caption if available
              const caption = idx === 0 ? text : "";
              const payload = formatWhatsAppMediaPayload(cleanPhone, att, caption);

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
            console.error(
              "WhatsApp Cloud API send error:",
              waErr.response?.data || waErr.message
            );
          }
        }
      }
    }

    const msgData = {
      roomId,
      platform,
      senderId: senderUser._id,
      senderRole: senderUser.role,
      receiverId: isStaff
        ? receiverId || roomId.replace(/^(fb_|ig_|wa_)/, "")
        : "admin",
      text,
      attachments,
      isRead: false,
      externalMetaId,
      metaMessageId: externalMetaId,
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

    // Compute preview text for conversations list
    let lastMessageText = text;
    if (!hasText && hasAttachments) {
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
    const updateDoc = {
      $set: {
        lastMessage: lastMessageText,
        updatedAt: now,
        platform,
        ...(senderUser.role === "customer"
          ? {
              customer: {
                _id: senderUser._id,
                id: senderUser._id,
                name:
                  senderUser.name ||
                  senderUser.userName ||
                  senderUser.email ||
                  "Customer",
                userName:
                  senderUser.userName ||
                  senderUser.name ||
                  senderUser.email ||
                  "Customer",
                email: senderUser.email || null,
                phone: senderUser.phone || null,
                avatar: senderUser.avatar || null,
              },
            }
          : {}),
      },
      $setOnInsert: {
        customerId: isStaff ? receiverId : senderUser._id,
        createdAt: now,
        ...(isStaff ? { unreadCount: 0 } : {}),
      },
      ...(senderUser.role === "customer" ? { $inc: { unreadCount: 1 } } : {}),
    };

    const convRes = await conversationCollection.findOneAndUpdate(
      { roomId },
      updateDoc,
      { upsert: true, returnDocument: "after" }
    );
    const updatedConv = convRes?.value ?? convRes;

    io.to(roomId).emit("receiveMessage", msgData);

    if (senderUser.role === "customer") {
      const unreadCount =
        typeof updatedConv?.unreadCount === "number"
          ? updatedConv.unreadCount
          : await msgCollection.countDocuments({
              roomId,
              isRead: false,
              senderRole: "customer",
            });

      io.to("admin_global_room").emit("newConversationUpdate", {
        roomId,
        lastMessage: lastMessageText,
        updatedAt: now,
        customerId: senderUser._id,
        platform,
        customer: updatedConv?.customer,
        unreadCount,
      });

      io.to("admin_global_room").emit("updateUnreadCount", {
        roomId,
        count: unreadCount,
      });

      await createAndSendNotification({
        type: "new_message",
        title: "New Message Received",
        message: `You received a message from ${senderUser.email || "Customer"}: "${
          lastMessageText.length > 40
            ? lastMessageText.substring(0, 37) + "..."
            : lastMessageText
        }"`,
        link: `/dashboard/inbox/web/${senderUser._id}`,
        recipientRole: "staff",
      });
    } else {
      io.to("admin_global_room").emit("newConversationUpdate", {
        roomId,
        lastMessage: lastMessageText,
        updatedAt: now,
        customerId: receiverId,
        platform,
        customer: updatedConv?.customer,
      });
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: msgData,
    });
  } catch (error) {
    console.error("Error in sendMessage:", error);
    res.status(500).json({ success: false, message: "Internal server error: " + error.message });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { roomId, before } = req.query;

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const skip = (page - 1) * limit;

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }

    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");
    const roomQuery = {
      $in: [
        roomId,
        cleanId,
        `fb_${cleanId}`,
        `ig_${cleanId}`,
        `wa_${cleanId}`,
        `room_${cleanId}`,
      ],
    };

    const queryFilter = { roomId: roomQuery };
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        queryFilter.createdAt = { $lt: beforeDate };
      }
    }

    // Fetch limit + 1 documents to determine hasMore without an expensive countDocuments scan
    let cursor = msgCollection.find(queryFilter).sort({ createdAt: -1 });
    if (!before && skip > 0) {
      cursor = cursor.skip(skip);
    }

    const rawMessages = await cursor.limit(limit + 1).toArray();
    const hasMore = rawMessages.length > limit;
    const sliced = hasMore ? rawMessages.slice(0, limit) : rawMessages;
    const sortedMessages = sliced.reverse();
    const nextCursor =
      sortedMessages.length > 0 ? sortedMessages[0].createdAt : null;

    res.status(200).json({
      success: true,
      message: "Messages fetched successfully",
      data: sortedMessages,
      pagination: {
        page,
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Error in getMessages:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getSidebarConversations = async (req, res) => {
  try {
    const { platform, before, search } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const page = parseInt(req.query.page) || 1;
    const skip = !before && page > 1 ? (page - 1) * limit : 0;

    const andConditions = [];
    if (platform === "web") {
      andConditions.push({
        $or: [
          { platform: "web" },
          { platform: { $exists: false } },
          { roomId: { $regex: "^room_" } },
        ],
      });
    } else if (platform === "facebook") {
      andConditions.push({
        $or: [
          { platform: "facebook" },
          { roomId: { $regex: "^fb_" } },
        ],
      });
    } else if (platform === "instagram") {
      andConditions.push({
        $or: [
          { platform: "instagram" },
          { roomId: { $regex: "^ig_" } },
        ],
      });
    } else if (platform === "whatsapp") {
      andConditions.push({
        $or: [
          { platform: "whatsapp" },
          { roomId: { $regex: "^wa_" } },
        ],
      });
    }

    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        andConditions.push({ updatedAt: { $lt: beforeDate } });
      }
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      andConditions.push({
        $or: [
          { "customer.name": regex },
          { "customer.userName": regex },
          { "customer.email": regex },
          { "customer.phone": regex },
          { lastMessage: regex },
          { roomId: regex },
        ],
      });
    }

    const filter =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
          ? andConditions[0]
          : { $and: andConditions };

    let queryCursor = conversationCollection
      .find(filter)
      .sort({ updatedAt: -1 });

    if (skip > 0) {
      queryCursor = queryCursor.skip(skip);
    }

    const fetchedConversations = await queryCursor.limit(limit + 1).toArray();
    const hasMore = fetchedConversations.length > limit;
    const rawConversations = hasMore
      ? fetchedConversations.slice(0, limit)
      : fetchedConversations;

    // Batch resolve web customer profiles in a single query instead of N+1 queries
    const missingCustomerIds = [];
    for (const conv of rawConversations) {
      const convPlatform =
        conv.platform ||
        (conv.roomId?.startsWith("fb_")
          ? "facebook"
          : conv.roomId?.startsWith("ig_")
            ? "instagram"
            : conv.roomId?.startsWith("wa_")
              ? "whatsapp"
              : "web");

      if (convPlatform === "web" && !conv.customer && conv.customerId) {
        missingCustomerIds.push(conv.customerId);
      }
    }

    const userMap = new Map();
    if (missingCustomerIds.length > 0) {
      const users = await userCollection
        .find(
          { _id: { $in: missingCustomerIds } },
          { projection: { name: 1, userName: 1, email: 1, avatar: 1, phone: 1 } }
        )
        .toArray();

      for (const u of users) {
        userMap.set(String(u._id), {
          _id: u._id,
          id: u._id,
          name: u.name || u.userName || u.email,
          userName: u.userName || u.name || u.email,
          email: u.email,
          phone: u.phone || null,
          avatar: u.avatar || null,
        });
      }
    }

    const conversations = rawConversations.map((conv) => {
      let convPlatform = conv.platform;
      if (!convPlatform) {
        if (conv.roomId?.startsWith("fb_")) convPlatform = "facebook";
        else if (conv.roomId?.startsWith("ig_")) convPlatform = "instagram";
        else if (conv.roomId?.startsWith("wa_")) convPlatform = "whatsapp";
        else convPlatform = "web";
      }

      if (convPlatform === "web") {
        const customer =
          conv.customer ||
          (conv.customerId ? userMap.get(String(conv.customerId)) : null);

        return {
          ...conv,
          platform: "web",
          customer: customer || {
            _id: conv.customerId,
            id: conv.customerId,
            name: "Customer",
            userName: "Customer",
            avatar: null,
          },
        };
      }

      return {
        ...conv,
        platform: convPlatform,
        customer: conv.customer || {
          _id: conv.platformId || conv.roomId,
          id: conv.platformId || conv.roomId,
          name:
            convPlatform === "whatsapp"
              ? "WhatsApp User"
              : `${convPlatform} User`,
          userName:
            convPlatform === "whatsapp"
              ? "WhatsApp User"
              : `${convPlatform} User`,
          avatar: null,
        },
      };
    });

    const nextCursor =
      conversations.length > 0
        ? conversations[conversations.length - 1].updatedAt
        : null;

    res.status(200).json({
      success: true,
      message: "Conversations fetched successfully",
      data: conversations,
      pagination: {
        page,
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Error in getSidebarConversations:", error);
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

    const messages = await msgCollection.find({ roomId }).toArray();

    for (const message of messages) {
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.publicId) {
            try {
              await cloudinary.uploader.destroy(attachment.publicId);
            } catch (cloudinaryError) {
              console.error("Error deleting file from Cloudinary:", cloudinaryError);
            }
          }
        }
      }
    }

    await msgCollection.deleteMany({ roomId });
    await conversationCollection.deleteOne({ roomId });

    io.to(roomId).emit("conversationDeleted", { roomId });
    io.to("admin_global_room").emit("newConversationUpdate", { roomId, deleted: true });

    res.status(200).json({
      success: true,
      message: "Conversation deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteConversation:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * 5. Fetch Customer CRM Details for Right Side Panel (with Smart Chat Extraction & Client Matching)
 */
export const getCustomerCRMDetails = async (req, res) => {
  try {
    const { roomId } = req.query;
    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }

    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");
    const roomQuery = {
      $in: [
        roomId,
        cleanId,
        `fb_${cleanId}`,
        `ig_${cleanId}`,
        `wa_${cleanId}`,
        `room_${cleanId}`,
      ],
    };

    const conversation = await conversationCollection.findOne({
      roomId: roomQuery,
    });
    if (!conversation) {
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });
    }

    const platform =
      conversation.platform ||
      (String(roomId).startsWith("fb_")
        ? "facebook"
        : String(roomId).startsWith("ig_")
          ? "instagram"
          : String(roomId).startsWith("wa_")
            ? "whatsapp"
            : "web");

    let customerData = { ...(conversation.customer || {}) };
    let customerEmail = customerData.email;
    let customerPhone = customerData.phone;
    let customerUserId =
      conversation.customerId || customerData.id || customerData._id;

    // 1. If web platform, lookup in Users collection for full user profile
    if (platform === "web" && customerUserId) {
      const userFilter = ObjectId.isValid(String(customerUserId))
        ? { $or: [{ _id: customerUserId }, { _id: new ObjectId(String(customerUserId)) }] }
        : { _id: customerUserId };
      const user = await userCollection.findOne(userFilter, {
        projection: { password: 0 },
      });
      if (user) {
        customerData = {
          ...customerData,
          name: user.name || user.userName || user.email,
          userName: user.userName || user.name || user.email,
          email: user.email,
          phone: user.phone || customerData.phone,
          avatar: user.avatar || customerData.avatar,
          role: user.role,
          createdAt: user.createdAt,
        };
        customerEmail = user.email;
        customerPhone = user.phone || customerPhone;
      }
    }

    // 2. Scan recent messages in this conversation to auto-detect Email & Phone if missing
    const recentMsgs = await msgCollection
      .find({ roomId: roomQuery })
      .sort({ createdAt: -1 })
      .limit(60)
      .toArray();

    const extracted = extractContactInfoFromMessages(
      recentMsgs,
      conversation.roomId || roomId,
      platform
    );

    if ((!customerEmail || isPlaceholderClientEmail(customerEmail)) && extracted.email) {
      customerEmail = extracted.email;
      customerData.email = extracted.email;
    }
    if (!customerPhone && extracted.phone) {
      customerPhone = extracted.phone;
      customerData.phone = extracted.phone;
    }

    // 3. Check if customer is already in Clients collection
    const existingClient = await findMatchingClient({
      clientId: conversation.clientId || customerData.clientId,
      email: customerEmail,
      phone: customerPhone,
      roomId: conversation.roomId || roomId,
      platformId: conversation.platformId || cleanId,
    });

    let matchedClientId = conversation.clientId ? String(conversation.clientId) : null;

    if (existingClient) {
      matchedClientId = String(existingClient._id);
      const realClientEmail = !isPlaceholderClientEmail(existingClient.email)
        ? existingClient.email
        : null;

      customerData = {
        ...customerData,
        clientId: matchedClientId,
        name: existingClient.name || customerData.name || customerData.userName,
        userName: existingClient.name || customerData.userName || customerData.name,
        email: customerEmail || realClientEmail || null,
        phone: customerPhone || existingClient.phone || null,
        company: existingClient.company || customerData.company || null,
        clientRole: existingClient.role || customerData.clientRole || "Client",
        country: existingClient.country || customerData.country || "Bangladesh",
        avatar: customerData.avatar || existingClient.logo || null,
      };

      // Persist clientId link on Conversation if not saved yet
      if (!conversation.clientId || !conversation.isClient) {
        await conversationCollection.updateOne(
          { _id: conversation._id },
          {
            $set: {
              clientId: matchedClientId,
              isClient: true,
            },
          }
        );
      }
    }

    // 4. Lookup customer orders from Orders collection (by clientId, roomId, email, or customerUserId)
    const orderOrClauses = [
      { roomId: roomQuery },
    ];
    if (matchedClientId) {
      orderOrClauses.push({ clientId: matchedClientId });
      if (ObjectId.isValid(matchedClientId)) {
        orderOrClauses.push({ clientId: new ObjectId(matchedClientId) });
      }
    }
    if (customerEmail && !isPlaceholderClientEmail(customerEmail)) {
      orderOrClauses.push(
        { "customer.email": customerEmail },
        { "user.email": customerEmail },
        { "client.email": customerEmail },
        { "epsData.CustomerEmail": customerEmail }
      );
    }
    if (customerUserId) {
      orderOrClauses.push(
        { clientId: String(customerUserId) },
        { customerId: String(customerUserId) },
        { "user._id": customerUserId }
      );
    }

    const orders = await orderCollection
      .find({ $or: orderOrClauses })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // Resolve service titles for slug-based orders
    const serviceSlugs = [
      ...new Set(
        orders
          .map((o) => o.service)
          .filter((s) => s && s !== "custom")
      ),
    ];
    const serviceTitleMap = new Map();
    if (serviceSlugs.length > 0) {
      const servicesList = await serviceCollection
        .find({ slug: { $in: serviceSlugs } }, { projection: { slug: 1, title: 1 } })
        .toArray();
      for (const s of servicesList) {
        serviceTitleMap.set(s.slug, s.title);
      }
    }

    const totalSpent = orders
      .filter((o) => o.status !== "Cancelled")
      .reduce(
        (sum, ord) =>
          sum + (Number(ord.amount || ord.servicePrice || ord.price || 0) || 0),
        0
      );

    const extractedInfo = {
      name:
        customerData.name ||
        customerData.userName ||
        existingClient?.name ||
        "Customer",
      email:
        customerEmail && !isPlaceholderClientEmail(customerEmail)
          ? customerEmail
          : "",
      phone: customerPhone || "",
      company:
        existingClient?.company ||
        customerData.company ||
        (platform === "facebook"
          ? "Facebook Client"
          : platform === "instagram"
            ? "Instagram Client"
            : platform === "whatsapp"
              ? "WhatsApp Client"
              : "Individual / Self"),
      clientRole: existingClient?.role || customerData.clientRole || "Client",
      country: existingClient?.country || customerData.country || "Bangladesh",
      avatar: customerData.avatar || existingClient?.logo || "",
      detectedFromChat: {
        email: Boolean(extracted.email),
        phone: Boolean(extracted.phone),
      },
    };

    return res.status(200).json({
      success: true,
      data: {
        customer: customerData,
        isClient: Boolean(existingClient),
        clientId: matchedClientId,
        existingClient: existingClient
          ? {
              _id: existingClient._id,
              name: existingClient.name,
              company: existingClient.company,
              role: existingClient.role,
              email: isPlaceholderClientEmail(existingClient.email)
                ? ""
                : existingClient.email,
              isPlaceholderEmail: Boolean(
                existingClient.isPlaceholderEmail ||
                  isPlaceholderClientEmail(existingClient.email)
              ),
              phone: existingClient.phone || "",
              country: existingClient.country || "Bangladesh",
              logo: existingClient.logo || "",
            }
          : null,
        extractedInfo,
        platform,
        roomId: conversation.roomId || roomId,
        notes: conversation.internalNotes || [],
        ordersCount: orders.length,
        totalSpent,
        recentOrders: orders.slice(0, 6).map((o) => ({
          _id: o._id,
          orderId: o.orderId || o._id,
          serviceTitle:
            o.service === "custom"
              ? o.serviceName || "Custom Service"
              : o.serviceTitle ||
                serviceTitleMap.get(o.service) ||
                o.serviceName ||
                o.service ||
                "Service",
          price: o.price || o.servicePrice || 0,
          amount: o.amount ?? o.servicePrice ?? o.price ?? 0,
          payment: o.payment || "Pending",
          status: o.status || "Pending",
          createdAt: o.createdAt,
        })),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error in getCustomerCRMDetails:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

/**
 * 5b. Confirm Order from Conversation & Auto-Add/Update Customer as Client
 */
export const confirmOrderFromChat = async (req, res) => {
  try {
    const {
      roomId,
      // Client fields
      clientId: requestedClientId,
      clientName,
      company,
      clientRole,
      clientEmail,
      clientPhone,
      country,
      // Order fields
      slug,
      planId,
      serviceName,
      servicePrice,
      discount,
      payment = "Pending",
      paymentMethod = "Bank",
      amount,
      deadline,
      assignToSelf,
      assignedTo,
      rewardPoints,
      orderNote,
    } = req.body;

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Conversation roomId is required" });
    }
    if (!slug) {
      return res
        .status(400)
        .json({ success: false, message: "Please select a service for the order" });
    }

    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");
    const roomQuery = {
      $in: [
        roomId,
        cleanId,
        `fb_${cleanId}`,
        `ig_${cleanId}`,
        `wa_${cleanId}`,
        `room_${cleanId}`,
      ],
    };

    const conversation = await conversationCollection.findOne({
      roomId: roomQuery,
    });

    const platform =
      conversation?.platform ||
      (String(roomId).startsWith("fb_")
        ? "facebook"
        : String(roomId).startsWith("ig_")
          ? "instagram"
          : String(roomId).startsWith("wa_")
            ? "whatsapp"
            : "web");

    const canonicalRoomId = conversation?.roomId || roomId;
    const customerAvatar = conversation?.customer?.avatar || "";
    const resolvedName =
      (clientName || "").trim() ||
      conversation?.customer?.name ||
      conversation?.customer?.userName ||
      "Customer";
    const resolvedCompany =
      (company || "").trim() ||
      conversation?.customer?.company ||
      (platform === "facebook"
        ? "Facebook Client"
        : platform === "instagram"
          ? "Instagram Client"
          : platform === "whatsapp"
            ? "WhatsApp Client"
            : "Individual / Self");
    const resolvedRole = (clientRole || "").trim() || "Client";
    const resolvedCountry = (country || "").trim() || "Bangladesh";
    const resolvedPhone =
      (clientPhone || "").trim() ||
      conversation?.customer?.phone ||
      (platform === "whatsapp" ? `+${cleanId.replace(/[^0-9]/g, "")}` : "");
    const cleanEmail = (clientEmail || "").trim().toLowerCase();

    // --- STEP 1: Find or Create Client in Clients Collection ---
    let existingClient = await findMatchingClient({
      clientId: requestedClientId || conversation?.clientId,
      email: cleanEmail,
      phone: resolvedPhone,
      roomId: canonicalRoomId,
      platformId: conversation?.platformId || cleanId,
    });

    let finalClient = null;
    let clientWasCreated = false;

    if (existingClient) {
      const updatedFields = {
        name: resolvedName || existingClient.name,
        company: resolvedCompany || existingClient.company,
        role: resolvedRole || existingClient.role,
        phone: resolvedPhone || existingClient.phone || "",
        country: resolvedCountry || existingClient.country || "Bangladesh",
        roomId: existingClient.roomId || canonicalRoomId,
        platform: existingClient.platform || platform,
        updatedAt: new Date(),
      };

      if (!existingClient.logo && customerAvatar) {
        updatedFields.logo = customerAvatar;
      }

      // If staff entered a real email and client previously had a placeholder email, upgrade it
      if (
        cleanEmail &&
        !isPlaceholderClientEmail(cleanEmail) &&
        cleanEmail !== existingClient.email
      ) {
        const emailTaken = await clientCollection.findOne({
          email: cleanEmail,
          _id: { $ne: existingClient._id },
        });
        if (!emailTaken) {
          updatedFields.email = cleanEmail;
          updatedFields.isPlaceholderEmail = false;
        }
      }

      await clientCollection.updateOne(
        { _id: existingClient._id },
        { $set: updatedFields }
      );

      finalClient = {
        ...existingClient,
        ...updatedFields,
        _id: existingClient._id,
      };
    } else {
      // Create new Client automatically
      const isPlaceholder = !cleanEmail || isPlaceholderClientEmail(cleanEmail);
      const safeCleanId = cleanId.replace(/[^a-zA-Z0-9_-]/g, "") || Date.now();
      let emailToSave = isPlaceholder
        ? `${platform}_${safeCleanId}@client.nexoro.local`
        : cleanEmail;

      const newClientDoc = {
        name: resolvedName,
        company: resolvedCompany,
        role: resolvedRole,
        email: emailToSave,
        isPlaceholderEmail: isPlaceholder,
        phone: resolvedPhone,
        country: resolvedCountry,
        slider: false,
        logo: customerAvatar || "",
        public_id: "",
        roomId: canonicalRoomId,
        platform,
        platformId: conversation?.platformId || cleanId,
        joined: new Date(),
      };

      try {
        const insertRes = await clientCollection.insertOne(newClientDoc);
        finalClient = { ...newClientDoc, _id: insertRes.insertedId };
        clientWasCreated = true;
      } catch (dupErr) {
        if (dupErr.code === 11000) {
          // Email collision: check if it matches an existing client or needs unique fallback
          const collidedClient = await clientCollection.findOne({
            email: emailToSave,
          });
          if (collidedClient) {
            finalClient = collidedClient;
            clientWasCreated = false;
          } else {
            newClientDoc.email = `${platform}_${safeCleanId}_${Date.now()}@client.nexoro.local`;
            newClientDoc.isPlaceholderEmail = true;
            const retryRes = await clientCollection.insertOne(newClientDoc);
            finalClient = { ...newClientDoc, _id: retryRes.insertedId };
            clientWasCreated = true;
          }
        } else {
          throw dupErr;
        }
      }
    }

    const finalClientId = String(finalClient._id);

    // --- STEP 2: Create Order in Orders Collection ---
    const orderId = await getNextOrderId();

    let price = 0;
    let serviceTitle = slug;
    let discountNum = 0;
    let amountNum = 0;

    if (slug === "custom") {
      price = Number(servicePrice) || 0;
      serviceTitle = (serviceName || "").trim() || "Custom Service";
      discountNum = Number(discount) || 0;
      amountNum =
        payment === "Success" ? Math.max(0, price - discountNum) : Number(amount) || 0;
    } else {
      const serviceData = await serviceCollection.findOne({ slug });
      const planData = serviceData?.plans?.find(
        (plan) => plan.id?.toString() === planId?.toString()
      );
      const planPriceUSD = Number(planData?.price) || 0;
      price = await convertToBDT(planPriceUSD);
      serviceTitle = serviceData?.title || slug;

      discountNum = Number(discount)
        ? await convertToBDT(Number(discount))
        : 0;

      amountNum =
        payment === "Success"
          ? Math.max(0, price - discountNum)
          : Number(amount)
            ? await convertToBDT(Number(amount))
            : 0;
    }

    // Determine creator & assignment
    let createdBy = req.body.createdBy || "Admin";
    let createdByRole = req.body.createdByRole || "admin";
    let createdById = null;
    let callerUser = null;

    if (req.user?.email) {
      callerUser = await userCollection.findOne({ email: req.user.email });
      if (callerUser) {
        createdById = callerUser._id;
        createdByRole = callerUser.role || "admin";
        createdBy =
          callerUser.name ||
          callerUser.displayName ||
          callerUser.email ||
          createdBy;
      }
    }

    let initialAssignedTo = null;
    const shouldSelfAssign =
      assignToSelf === true || assignToSelf === "true";

    if (shouldSelfAssign && callerUser?._id) {
      initialAssignedTo = callerUser._id.toString();
    } else if (assignedTo) {
      initialAssignedTo = String(assignedTo);
    }

    const initialStatus = initialAssignedTo ? "Processing" : "Pending";
    const parsedRewardPoints =
      rewardPoints !== undefined && rewardPoints !== null
        ? Math.max(0, Number(rewardPoints))
        : 5;

    const newOrderDoc = {
      clientId: finalClientId,
      clientName: resolvedName,
      roomId: canonicalRoomId,
      platform,
      orderId,
      service: slug,
      serviceName: slug === "custom" ? serviceTitle : undefined,
      servicePrice: slug === "custom" ? price : undefined,
      planId: slug === "custom" ? null : planId,
      price,
      discount: discountNum,
      status: initialStatus,
      createdBy,
      createdByRole,
      createdById,
      assignedTo: initialAssignedTo,
      rewardPoints: parsedRewardPoints,
      tasks: [],
      amount: amountNum,
      payment,
      paymentMethod,
      deadline: deadline ? new Date(deadline) : null,
      createdAt: new Date(),
    };

    const orderInsertRes = await orderCollection.insertOne(newOrderDoc);
    const createdOrder = { ...newOrderDoc, _id: orderInsertRes.insertedId };

    // --- STEP 3: Link Conversation & Add System Timeline Message / Note ---
    const updatedCustomerObj = {
      ...(conversation?.customer || {}),
      id: conversation?.customer?.id || cleanId,
      _id: conversation?.customer?._id || cleanId,
      clientId: finalClientId,
      name: resolvedName,
      userName: resolvedName,
      email: !isPlaceholderClientEmail(finalClient.email)
        ? finalClient.email
        : conversation?.customer?.email || null,
      phone: resolvedPhone || conversation?.customer?.phone || null,
      company: resolvedCompany,
      country: resolvedCountry,
      avatar: customerAvatar || finalClient.logo || null,
    };

    const convUpdateOps = {
      $set: {
        clientId: finalClientId,
        isClient: true,
        customer: updatedCustomerObj,
        updatedAt: new Date(),
      },
    };

    if (orderNote && String(orderNote).trim()) {
      convUpdateOps.$push = {
        internalNotes: {
          _id: `${Date.now()}`,
          text: `[Order #${orderId} - ${serviceTitle}]: ${String(orderNote).trim()}`,
          author: createdBy,
          authorEmail: req.user?.email || "",
          createdAt: new Date(),
        },
      };
    }

    await conversationCollection.updateOne(
      { roomId: canonicalRoomId },
      convUpdateOps,
      { upsert: true }
    );

    // Insert system event message into chat timeline
    const systemText = `Order #${orderId} (${serviceTitle} - BDT ${price.toLocaleString()}) confirmed by ${createdBy} • ${
      clientWasCreated
        ? `${resolvedName} automatically added to Clients`
        : `Linked to Client: ${resolvedName}`
    }`;

    const sysMsg = {
      roomId: canonicalRoomId,
      platform,
      senderId: "system",
      senderRole: "system",
      type: "system",
      isSystem: true,
      receiverId: "admin",
      text: systemText,
      attachments: [],
      isRead: true,
      createdAt: new Date(),
    };

    const sysMsgRes = await msgCollection.insertOne(sysMsg);
    const savedSysMsg = { ...sysMsg, _id: sysMsgRes.insertedId };

    // Real-time Socket Broadcasts
    io.to(canonicalRoomId).emit("receiveMessage", savedSysMsg);
    io.to("admin_global_room").emit("receiveMessage", savedSysMsg);
    io.to("admin_global_room").emit("newConversationUpdate", {
      roomId: canonicalRoomId,
      platform,
      customerId: conversation?.customerId || cleanId,
      clientId: finalClientId,
      isClient: true,
      customer: updatedCustomerObj,
      updatedAt: new Date(),
    });

    // Dashboard & Staff Notifications
    await createAndSendNotification({
      type: "new_order",
      title: "Order Confirmed from Inbox",
      message: `Order ${orderId} (${serviceTitle}) confirmed for ${resolvedName} by ${createdBy}.`,
      link: "/dashboard/orders",
    });

    if (initialAssignedTo) {
      await createAndSendNotification({
        type: "project_assigned",
        title: "New Project Assigned",
        message: `You have been assigned to order #${orderId} (${serviceTitle}).`,
        link: "/dashboard/projects",
        recipientId: initialAssignedTo,
      });
    }

    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    return res.status(201).json({
      success: true,
      message: clientWasCreated
        ? `Order #${orderId} created & ${resolvedName} automatically added as a Client!`
        : `Order #${orderId} created & linked to existing Client ${resolvedName}!`,
      data: {
        order: createdOrder,
        client: finalClient,
        clientWasCreated,
        systemMessage: savedSysMsg,
      },
    });
  } catch (error) {
    console.error("Error in confirmOrderFromChat:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to confirm order from chat: " + error.message,
    });
  }
};

/**
 * 6. Add Internal Staff Note
 */
export const addInternalNote = async (req, res) => {
  try {
    const { roomId, text } = req.body;
    const authorUser = req.user;

    if (!roomId || !text || text.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Room ID and note text are required" });
    }

    const newNote = {
      _id: new Date().getTime().toString(),
      text: text.trim(),
      author: authorUser?.name || authorUser?.email || "Staff",
      authorEmail: authorUser?.email,
      createdAt: new Date(),
    };

    await conversationCollection.updateOne(
      { roomId },
      {
        $push: { internalNotes: newNote },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Note added successfully",
      data: newNote,
    });
  } catch (error) {
    console.error("Error in addInternalNote:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

/**
 * 7. Delete Internal Staff Note
 */
export const deleteInternalNote = async (req, res) => {
  try {
    const { roomId, noteId } = req.body;
    if (!roomId || !noteId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID and note ID are required" });
    }

    await conversationCollection.updateOne(
      { roomId },
      { $pull: { internalNotes: { _id: noteId } } }
    );

    return res
      .status(200)
      .json({ success: true, message: "Note deleted successfully" });
  } catch (error) {
    console.error("Error in deleteInternalNote:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

/**
 * 8. Canned Responses (Saved Replies)
 */
const defaultCannedResponses = [
  {
    _id: "def_1",
    shortcut: "/greeting",
    title: "Greeting & Welcome",
    text: "Hello! Thank you for reaching out to Nexoro Solutions. How can we assist you today?",
    category: "General",
  },
  {
    _id: "def_2",
    shortcut: "/services",
    title: "Our Services Overview",
    text: "We provide Web Development, Mobile Apps, UI/UX Design, and Digital Marketing. Let us know your requirements or check our portfolio for details!",
    category: "Services",
  },
  {
    _id: "def_3",
    shortcut: "/pricing",
    title: "Pricing & Custom Quote",
    text: "Our service pricing is tailored based on project scope. Please let us know your requirements, or view our plans on our website.",
    category: "Sales",
  },
  {
    _id: "def_4",
    shortcut: "/call",
    title: "Schedule Consultation Call",
    text: "Would you like to schedule a quick 10-minute consultation call? Please let us know what time works best for you.",
    category: "Meeting",
  },
  {
    _id: "def_5",
    shortcut: "/hours",
    title: "Office Hours",
    text: "Our team is available Saturday to Thursday, 10:00 AM - 7:00 PM. We will get back to you shortly.",
    category: "Support",
  },
  {
    _id: "def_6",
    shortcut: "/payment",
    title: "Payment Information",
    text: "We accept payments via bKash, Nagad, Bank Transfer, and Credit/Debit cards. You can also pay directly through our client dashboard.",
    category: "Billing",
  },
];

export const getCannedResponses = async (req, res) => {
  try {
    const cannedCollection = client.db("nexoro").collection("CannedResponses");
    const customResponses = await cannedCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: [...defaultCannedResponses, ...customResponses],
    });
  } catch (error) {
    console.error("Error fetching canned responses:", error);
    return res.status(200).json({ success: true, data: defaultCannedResponses });
  }
};

export const createCannedResponse = async (req, res) => {
  try {
    const { shortcut, title, text, category = "Custom" } = req.body;
    if (!shortcut || !text) {
      return res
        .status(400)
        .json({ success: false, message: "Shortcut and text are required" });
    }

    const cannedCollection = client.db("nexoro").collection("CannedResponses");
    const newCanned = {
      shortcut: shortcut.startsWith("/") ? shortcut : `/${shortcut}`,
      title: title || shortcut,
      text,
      category,
      createdAt: new Date(),
    };

    const result = await cannedCollection.insertOne(newCanned);
    return res.status(201).json({
      success: true,
      message: "Canned response created successfully",
      data: { ...newCanned, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Error creating canned response:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
