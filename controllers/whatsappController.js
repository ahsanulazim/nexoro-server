import axios from "axios";
import { config } from "dotenv";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { io } from "../socket/socket.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";

config();

const msgCollection = client.db("nexoro").collection("Messages");
const conversationCollection = client.db("nexoro").collection("Conversations");

/**
 * Helper to download media from WhatsApp Cloud API and upload to Cloudinary
 */
const downloadAndUploadWhatsAppMedia = async (mediaId, defaultName = "whatsapp_file") => {
  try {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
    if (!accessToken || !mediaId) return null;

    // 1. Query WhatsApp Cloud API to get the download URL
    const mediaRes = await axios.get(`https://graph.facebook.com/v26.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const fileUrl = mediaRes.data?.url;
    if (!fileUrl) return null;

    // 2. Fetch binary stream using Bearer token
    const fileStream = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer",
    });

    // 3. Upload to Cloudinary
    return new Promise((resolve) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "whatsapp_attachments",
          resource_type: "auto",
        },
        (error, result) => {
          if (error) {
            console.error("Cloudinary upload error for WhatsApp media:", error);
            resolve(null);
          } else {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
            });
          }
        }
      );
      stream.end(Buffer.from(fileStream.data));
    });
  } catch (err) {
    console.error("Error downloading/uploading WhatsApp media:", err.response?.data || err.message);
    return null;
  }
};

/**
 * 1. WhatsApp Webhook Verification (GET /whatsapp/webhook)
 */
export const verifyWhatsAppWebhook = async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const verifyToken =
      process.env.WHATSAPP_VERIFY_TOKEN ||
      process.env.FB_VERIFY_TOKEN ||
      "NexoroSolutions@whatsapp";

    if (mode && token) {
      if (mode === "subscribe" && token === verifyToken) {
        console.log("WhatsApp Webhook verified successfully!");
        return res.status(200).send(challenge);
      }
    }
    return res.status(403).send("Invalid WhatsApp verification token");
  } catch (error) {
    console.error("WhatsApp webhook verification failed:", error);
    return res.status(500).send("Internal Server Error");
  }
};

/**
 * 2. WhatsApp Realtime Webhook Receiver (POST /whatsapp/webhook)
 */
export const handleWhatsAppWebhook = async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const messages = value?.messages || [];
          const contacts = value?.contacts || [];

          for (const msg of messages) {
            const senderPhone = msg.from; // e.g. "8801700000000"
            const timestamp = parseInt(msg.timestamp) * 1000 || Date.now();
            const contact = contacts.find((c) => c.wa_id === senderPhone);
            const customerName = contact?.profile?.name || `WhatsApp (+${senderPhone})`;

            let text = "";
            let attachments = [];

            if (msg.type === "text") {
              text = msg.text?.body || "";
            } else if (msg.type === "image") {
              text = msg.image?.caption || "📷 Sent a photo";
              const mediaUpload = await downloadAndUploadWhatsAppMedia(msg.image?.id, "whatsapp_image.jpg");
              attachments.push({
                type: "image",
                url: mediaUpload?.url || "",
                publicId: mediaUpload?.publicId || "",
                originalName: "whatsapp_image.jpg",
              });
            } else if (msg.type === "document") {
              text = msg.document?.filename || "📁 Sent a document";
              const mediaUpload = await downloadAndUploadWhatsAppMedia(msg.document?.id, msg.document?.filename || "document");
              attachments.push({
                type: msg.document?.mime_type || "document",
                url: mediaUpload?.url || "",
                publicId: mediaUpload?.publicId || "",
                originalName: msg.document?.filename || "document",
              });
            } else if (msg.type === "audio" || msg.type === "voice") {
              text = "🎤 Voice message";
              const audioId = (msg.audio || msg.voice)?.id;
              const mediaUpload = await downloadAndUploadWhatsAppMedia(audioId, "voice_message.ogg");
              attachments.push({
                type: "audio",
                url: mediaUpload?.url || "",
                publicId: mediaUpload?.publicId || "",
                originalName: "voice_message.ogg",
              });
            } else if (msg.type === "video") {
              text = msg.video?.caption || "🎥 Sent a video";
              const mediaUpload = await downloadAndUploadWhatsAppMedia(msg.video?.id, "whatsapp_video.mp4");
              attachments.push({
                type: "video",
                url: mediaUpload?.url || "",
                publicId: mediaUpload?.publicId || "",
                originalName: "whatsapp_video.mp4",
              });
            } else {
              text = `Sent a ${msg.type} message`;
            }

            const roomId = `wa_${senderPhone}`;
            const messageData = {
              roomId,
              platform: "whatsapp",
              senderId: senderPhone,
              senderRole: "customer",
              receiverId: "admin",
              text,
              attachments,
              isRead: false,
              createdAt: new Date(timestamp),
            };

            // 1. Save message to DB
            await msgCollection.insertOne(messageData);

            const customerObj = {
              id: senderPhone,
              _id: senderPhone,
              name: customerName,
              userName: customerName,
              phone: `+${senderPhone}`,
              avatar: null,
            };

            // 2. Upsert Conversation
            const convRes = await conversationCollection.findOneAndUpdate(
              { roomId },
              {
                $set: {
                  platform: "whatsapp",
                  platformId: senderPhone,
                  lastMessage: text,
                  updatedAt: new Date(timestamp),
                  customer: customerObj,
                },
                $setOnInsert: {
                  createdAt: new Date(timestamp),
                },
                $inc: { unreadCount: 1 },
              },
              { upsert: true, returnDocument: "after" }
            );
            const updatedConv = convRes?.value ?? convRes;

            // 3. Emit realtime socket events
            io.to(roomId).emit("receiveMessage", messageData);
            io.to("admin_global_room").emit("receiveMessage", messageData);
            io.to("admin_global_room").emit("newConversationUpdate", {
              roomId,
              lastMessage: text,
              updatedAt: new Date(timestamp),
              customerId: senderPhone,
              platform: "whatsapp",
              customer: customerObj,
            });

            const unreadCount =
              typeof updatedConv?.unreadCount === "number"
                ? updatedConv.unreadCount
                : await msgCollection.countDocuments({
                    roomId,
                    isRead: false,
                    senderRole: "customer",
                  });
            io.to("admin_global_room").emit("updateUnreadCount", { roomId, count: unreadCount });

            // 4. Send dashboard notification
            await createAndSendNotification({
              type: "new_message",
              title: "New WhatsApp Message",
              message: `From ${customerName}: "${text.length > 40 ? text.slice(0, 37) + '...' : text}"`,
              link: `/dashboard/inbox/whatsapp/${roomId}`,
              recipientRole: "staff",
            });
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error("Error processing WhatsApp webhook:", error);
    return res.status(500).send("Internal Server Error");
  }
};

/**
 * 3. Send WhatsApp Message from Admin Dashboard
 */
export const sendWhatsAppMessage = async (req, res) => {
  try {
    const { roomId, recipientId, text } = req.body;

    const recipientPhone = recipientId || (roomId?.startsWith("wa_") ? roomId.replace("wa_", "") : null);

    if (!recipientPhone || !text) {
      return res.status(400).json({ success: false, message: "Recipient phone number and text are required" });
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;

    if (!phoneNumberId) {
      return res.status(503).json({
        success: false,
        message: "WHATSAPP_PHONE_NUMBER_ID is not configured in backend .env",
      });
    }

    // Call WhatsApp Cloud API
    let waRes;
    try {
      waRes = await axios.post(
        `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipientPhone.replace(/[^0-9]/g, ""),
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
    } catch (apiErr) {
      console.error("WhatsApp Cloud API error:", apiErr.response?.data || apiErr.message);
      return res.status(502).json({
        success: false,
        message: "Failed to send message via WhatsApp Cloud API",
        error: apiErr.response?.data?.error?.message || apiErr.message,
      });
    }

    const messageData = {
      roomId: roomId || `wa_${recipientPhone}`,
      platform: "whatsapp",
      senderId: "admin",
      senderRole: "admin",
      receiverId: recipientPhone,
      text,
      attachments: [],
      isRead: true,
      metaMessageId: waRes.data?.messages?.[0]?.id,
      createdAt: new Date(),
    };

    // Save in DB
    await msgCollection.insertOne(messageData);

    // Update conversation
    await conversationCollection.updateOne(
      { roomId: messageData.roomId },
      {
        $set: {
          lastMessage: text,
          updatedAt: new Date(),
          platform: "whatsapp",
        },
      },
      { upsert: true }
    );

    // Emit socket
    io.to(messageData.roomId).emit("receiveMessage", messageData);
    io.to("admin_global_room").emit("receiveMessage", messageData);

    return res.status(200).json({
      success: true,
      message: "WhatsApp message sent successfully",
      data: messageData,
    });
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * 4. Fetch WhatsApp conversations
 */
export const getWhatsAppConversations = async (req, res) => {
  try {
    const conversations = await conversationCollection
      .find({ platform: "whatsapp" })
      .sort({ updatedAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Error fetching WhatsApp conversations:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};
