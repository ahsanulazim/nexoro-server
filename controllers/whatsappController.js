import axios from "axios";
import { config } from "dotenv";
import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { io } from "../socket/socket.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";

config();

const msgCollection = client.db("nexoro").collection("Messages");
const conversationCollection = client.db("nexoro").collection("Conversations");
const clientCollection = client.db("nexoro").collection("Clients");

/**
 * Helper to download media from WhatsApp Cloud API and upload to Cloudinary
 */
export const downloadAndUploadWhatsAppMedia = async (mediaId, defaultName = "whatsapp_file") => {
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
 * Helper to mark an incoming WhatsApp message as read via WhatsApp Cloud API
 */
export const markWhatsAppMessageAsRead = async (metaMessageId) => {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken || !metaMessageId) return;

    await axios.post(
      `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: metaMessageId,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Error marking WhatsApp message as read via Cloud API:", err.response?.data || err.message);
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
            // 1. Identify sender details (handling phone number, username, and BSUID)
            const rawPhone = msg.from ? String(msg.from).replace(/[^0-9]/g, "") : null;
            const rawBsuid = msg.from_user_id || null;

            // Match contact from contacts array
            const contact =
              contacts.find((c) => {
                if (rawPhone && c.wa_id && String(c.wa_id).replace(/[^0-9]/g, "") === rawPhone) return true;
                if (rawBsuid && c.user_id && c.user_id === rawBsuid) return true;
                return false;
              }) ||
              contacts[0] ||
              null;

            const finalPhone = rawPhone || (contact?.wa_id ? String(contact.wa_id).replace(/[^0-9]/g, "") : null);
            const finalBsuid = rawBsuid || contact?.user_id || null;
            const rawUsername = contact?.profile?.username || null;
            const finalUsername = rawUsername ? String(rawUsername).replace(/^@/, "").trim() : null;
            const profileName = contact?.profile?.name?.trim() || null;

            // Stable sender identifier: prefer phone number if available, otherwise BSUID, otherwise username
            const senderIdentifier = finalPhone || finalBsuid || finalUsername;
            if (!senderIdentifier) {
              console.warn("Skipping WhatsApp message with unknown sender identity:", msg);
              continue;
            }

            const timestamp = parseInt(msg.timestamp) * 1000 || Date.now();

            // Determine user-friendly customer name
            let customerName = "WhatsApp User";
            if (profileName) {
              customerName = profileName;
            } else if (finalUsername) {
              customerName = `@${finalUsername}`;
            } else if (finalPhone) {
              customerName = `WhatsApp (+${finalPhone})`;
            }

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

            // 2. Query existing conversation by BSUID, Phone, or Username (ignoring corrupted wa_undefined)
            let existingConv = null;
            const lookupOr = [];

            if (finalBsuid) {
              lookupOr.push({ "customer.bsuid": finalBsuid });
              lookupOr.push({ platformId: finalBsuid });
              lookupOr.push({ roomId: `wa_${finalBsuid}` });
            }
            if (finalPhone) {
              lookupOr.push({ "customer.phone": `+${finalPhone}` });
              lookupOr.push({ platformId: finalPhone });
              lookupOr.push({ roomId: `wa_${finalPhone}` });
            }
            if (finalUsername) {
              lookupOr.push({ "customer.userName": finalUsername });
              lookupOr.push({ "customer.userName": `@${finalUsername}` });
            }

            if (lookupOr.length > 0) {
              existingConv = await conversationCollection.findOne({
                platform: "whatsapp",
                roomId: { $ne: "wa_undefined" },
                $or: lookupOr,
              });
            }

            // Stable roomId
            const roomId =
              existingConv?.roomId && existingConv.roomId !== "wa_undefined"
                ? existingConv.roomId
                : `wa_${senderIdentifier}`;

            if (!existingConv) {
              existingConv = await conversationCollection.findOne({ roomId });
            }

            // Drop incoming messages if contact is blocked
            if (existingConv?.isBlocked) {
              console.log(
                `[WhatsApp Webhook] Blocked contact ${senderIdentifier} (${roomId}) sent a message. Dropping to prevent spam.`
              );
              continue;
            }

            const messageData = {
              roomId,
              platform: "whatsapp",
              senderId: senderIdentifier,
              senderRole: "customer",
              receiverId: "admin",
              text,
              attachments,
              isRead: false,
              metaMessageId: msg.id || null,
              createdAt: new Date(timestamp),
            };

            // 1. Save message to DB
            await msgCollection.insertOne(messageData);

            const customerObj = {
              id: senderIdentifier,
              _id: senderIdentifier,
              name: customerName,
              userName: finalUsername ? `@${finalUsername}` : customerName,
              phone: finalPhone ? `+${finalPhone}` : (existingConv?.customer?.phone || null),
              bsuid: finalBsuid || existingConv?.customer?.bsuid || null,
              avatar: null,
            };

            // 2. Upsert Conversation
            const convRes = await conversationCollection.findOneAndUpdate(
              { roomId },
              {
                $set: {
                  platform: "whatsapp",
                  platformId: senderIdentifier,
                  lastMessage: text,
                  updatedAt: new Date(timestamp),
                  lastCustomerMessageAt: new Date(timestamp),
                  customer: {
                    ...(existingConv?.customer || {}),
                    ...customerObj,
                  },
                },
                $setOnInsert: {
                  createdAt: new Date(timestamp),
                },
                $inc: { unreadCount: 1 },
              },
              { upsert: true, returnDocument: "after" }
            );
            const updatedConv = convRes?.value ?? convRes;

            // 2b. Sync CRM Client profile if this conversation is linked to a Client
            const targetClientId = existingConv?.clientId || existingConv?.customer?.clientId;
            if (targetClientId && ObjectId.isValid(String(targetClientId))) {
              const clientSync = { updatedAt: new Date() };
              if (finalPhone) clientSync.phone = `+${finalPhone}`;
              if (finalBsuid) clientSync.bsuid = finalBsuid;
              if (finalUsername) clientSync.userName = `@${finalUsername}`;
              if (profileName) clientSync.name = profileName;

              await clientCollection.updateOne(
                { _id: new ObjectId(String(targetClientId)) },
                { $set: clientSync }
              );
            }

            // 3. Emit realtime socket events
            io.to(roomId).emit("receiveMessage", messageData);
            io.to("admin_global_room").emit("receiveMessage", messageData);
            io.to("admin_global_room").emit("newConversationUpdate", {
              roomId,
              lastMessage: text,
              updatedAt: new Date(timestamp),
              lastCustomerMessageAt: new Date(timestamp),
              customerId: senderIdentifier,
              platform: "whatsapp",
              customer: customerObj,
              unreadCount: typeof updatedConv?.unreadCount === "number" ? updatedConv.unreadCount : 1,
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

          // 5. Process WhatsApp delivery, read, and failure status updates
          const statuses = value?.statuses || [];
          for (const statusItem of statuses) {
            const metaMessageId = statusItem.id;
            const deliveryStatus = statusItem.status; // "sent" | "delivered" | "read" | "failed"
            const statusTimestamp = parseInt(statusItem.timestamp) * 1000 || Date.now();
            const statusDate = new Date(statusTimestamp);

            if (!metaMessageId) continue;

            const updateData = {
              deliveryStatus,
              ...(deliveryStatus === "delivered" ? { deliveredAt: statusDate } : {}),
              ...(deliveryStatus === "read" ? { isRead: true, readAt: statusDate } : {}),
              ...(deliveryStatus === "sent" ? { sentAt: statusDate } : {}),
              ...(deliveryStatus === "failed"
                ? {
                    failedAt: statusDate,
                    failureReason:
                      statusItem.errors?.[0]?.message ||
                      statusItem.errors?.[0]?.title ||
                      "Message failed to deliver to recipient",
                  }
                : {}),
            };

            const updatedMsgRes = await msgCollection.findOneAndUpdate(
              {
                $or: [
                  { metaMessageId },
                  { externalMetaId: metaMessageId },
                ],
              },
              { $set: updateData },
              { returnDocument: "after" }
            );

            const updatedMsg = updatedMsgRes?.value ?? updatedMsgRes;
            const targetRoomId = updatedMsg?.roomId;

            if (targetRoomId) {
              const statusPayload = {
                messageId: updatedMsg._id,
                metaMessageId,
                status: deliveryStatus,
                roomId: targetRoomId,
                timestamp: statusDate,
                failureReason: updateData.failureReason || null,
              };

              io.to(targetRoomId).emit("messageStatusUpdate", statusPayload);
              io.to("admin_global_room").emit("messageStatusUpdate", statusPayload);

              if (deliveryStatus === "read") {
                io.to(targetRoomId).emit("messagesRead", { roomId: targetRoomId });
                io.to("admin_global_room").emit("messagesRead", { roomId: targetRoomId });
              }

              if (deliveryStatus === "failed") {
                io.to(targetRoomId).emit("messageDeliveryFailed", {
                  roomId: targetRoomId,
                  code: statusItem.errors?.[0]?.code || "DELIVERY_FAILED",
                  message: updateData.failureReason,
                });
                io.to("admin_global_room").emit("messageDeliveryFailed", {
                  roomId: targetRoomId,
                  code: statusItem.errors?.[0]?.code || "DELIVERY_FAILED",
                  message: updateData.failureReason,
                });
              }
            }
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

    let targetRecipient = recipientId || (roomId?.startsWith("wa_") ? roomId.replace("wa_", "") : null);

    if (!targetRecipient || targetRecipient === "admin" || targetRecipient === "undefined") {
      if (roomId) {
        const conv = await conversationCollection.findOne({ roomId });
        if (conv?.customer) {
          targetRecipient = conv.customer.phone || conv.customer.bsuid || conv.platformId;
        }
      }
    }

    if (!targetRecipient || targetRecipient === "undefined" || !text) {
      return res.status(400).json({ success: false, message: "Valid recipient and text are required" });
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;

    if (!phoneNumberId) {
      return res.status(503).json({
        success: false,
        message: "WHATSAPP_PHONE_NUMBER_ID is not configured in backend .env",
      });
    }

    // Official Meta logic:
    // If phone number -> use 'to'
    // If BSUID (users with hidden phone numbers / usernames) -> use 'recipient'
    const isPhoneNumber = /^\+?[0-9]+$/.test(String(targetRecipient).trim());
    const waPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "text",
      text: { preview_url: false, body: text },
    };

    if (isPhoneNumber) {
      waPayload.to = String(targetRecipient).replace(/[^0-9]/g, "");
    } else {
      waPayload.recipient = String(targetRecipient).trim();
    }

    // Call WhatsApp Cloud API
    let waRes;
    try {
      waRes = await axios.post(
        `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
        waPayload,
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
      roomId: roomId || `wa_${targetRecipient}`,
      platform: "whatsapp",
      senderId: "admin",
      senderRole: "admin",
      receiverId: targetRecipient,
      text,
      attachments: [],
      isRead: false,
      deliveryStatus: "sent",
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
      .find({ platform: "whatsapp", roomId: { $ne: "wa_undefined" } })
      .sort({ updatedAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Error fetching WhatsApp conversations:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};
