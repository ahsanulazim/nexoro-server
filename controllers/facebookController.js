import { config } from "dotenv";
import { fbApi } from "../utils/axios/fbApi.js";
import client from "../config/db.js";
import { io } from "../socket/socket.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";
import { handleWhatsAppWebhook } from "./whatsappController.js";

config();

const msgCollection = client.db("nexoro").collection("Messages");
const conversationCollection = client.db("nexoro").collection("Conversations");

/**
 * 1. Meta Webhook Verification (Messenger & Instagram)
 */
export const verifyFBWebhook = async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const allowedTokens = [
      process.env.FB_VERIFY_TOKEN || "NexoroSolutions@fbpass",
      process.env.WHATSAPP_VERIFY_TOKEN || "NexoroSolutions@whatsapp",
    ];

    if (mode && token) {
      if (mode === "subscribe" && allowedTokens.includes(token)) {
        console.log("Meta Webhook verified successfully!");
        return res.status(200).send(challenge);
      }
    }
    return res.status(403).send("Invalid verification token");
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return res.status(500).send("Internal Server Error");
  }
};

/**
 * Helper to fetch Facebook user profile (Name & Picture)
 */
export const getFBUserProfile = async (psid) => {
  try {
    let name = "Facebook User";
    let avatar = null;
    let isPermissionBlocked = false;

    // 1. Try querying fields first
    try {
      const res = await fbApi.get(`/${psid}`, {
        params: {
          fields: "first_name,last_name,name,profile_pic",
        },
      });
      const { first_name, last_name, name: resName, profile_pic } = res.data || {};
      name = [first_name, last_name].filter(Boolean).join(" ") || resName || "Facebook User";
      if (profile_pic) {
        avatar = profile_pic;
      }
    } catch (fieldErr) {
      const errCode = fieldErr.response?.data?.error?.code;
      if (errCode === 100 || errCode === 200) {
        // App is in Development mode or has Standard Access: Meta blocks public user PSID lookup
        isPermissionBlocked = true;
      } else {
        console.warn("Meta Graph API user profile fields warning:", fieldErr.response?.data?.error?.message || fieldErr.message);
      }
    }

    // 2. Fallback: Query picture endpoint directly only if not permission blocked
    if (!avatar && !isPermissionBlocked) {
      try {
        const picRes = await fbApi.get(`/${psid}/picture`, {
          params: {
            redirect: false,
            type: "large",
          },
        });
        if (picRes.data?.data?.url && !picRes.data?.data?.is_silhouette) {
          avatar = picRes.data.data.url;
        }
      } catch (picErr) {
        // Silently skip if picture endpoint also restricted
      }
    }

    return { name, avatar: avatar || null };
  } catch (err) {
    return {
      name: `Facebook User (${psid.slice(-4)})`,
      avatar: null,
    };
  }
};

/**
 * Helper to fetch Instagram user profile
 */
export const getIGUserProfile = async (igsid) => {
  try {
    const res = await fbApi.get(`/${igsid}`, {
      params: {
        fields: "name,username,profile_pic",
      },
    });
    const { name, username, profile_pic } = res.data || {};
    const displayName = name || username || "Instagram User";
    return {
      name: displayName,
      avatar: profile_pic || null,
    };
  } catch (err) {
    return {
      name: `Instagram User (${igsid.slice(-4)})`,
      avatar: null,
    };
  }
};

/**
 * 2. Meta Realtime Webhook Receiver (POST /webhook)
 * Handles incoming messages from Facebook Messenger and Instagram DM
 */
export const handleFBWebhook = async (req, res) => {
  try {
    const body = req.body;

    // Delegate to WhatsApp handler if Meta webhook sends WhatsApp payload
    if (body.object === "whatsapp_business_account") {
      return handleWhatsAppWebhook(req, res);
    }

    if (body.object === "page" || body.object === "instagram") {
      const isInstagram = body.object === "instagram";
      const defaultPlatform = isInstagram ? "instagram" : "facebook";

      // Iterate through entries
      for (const entry of body.entry || []) {
        const messagingList = entry.messaging || [];

        for (const webhookEvent of messagingList) {
          const senderId = webhookEvent.sender?.id;
          const recipientId = webhookEvent.recipient?.id;
          const timestamp = webhookEvent.timestamp || Date.now();
          const message = webhookEvent.message;

          // Ignore echoes (messages sent by the page/admin) to prevent duplicate loop
          if (!message || message.is_echo) {
            continue;
          }

          if (!senderId) continue;

          const platform = isInstagram ? "instagram" : "facebook";
          const roomId = `${platform === "instagram" ? "ig" : "fb"}_${senderId}`;

          // Check if conversation already has customer profile cached
          let conversation = await conversationCollection.findOne({ roomId });
          let customerName = conversation?.customer?.name;
          let customerAvatar = conversation?.customer?.avatar;

          if (!customerName || !customerAvatar || customerName.startsWith("Facebook User")) {
            const profile = isInstagram
              ? await getIGUserProfile(senderId)
              : await getFBUserProfile(senderId);
            if (!customerName || customerName.startsWith("Facebook User")) {
              customerName = profile.name;
            }
            if (profile.avatar) {
              customerAvatar = profile.avatar;
            }
          }

          // Extract text and attachments
          let text = message.text || "";
          let attachments = [];

          if (message.attachments && message.attachments.length > 0) {
            attachments = message.attachments.map((att) => ({
              type: att.type === "image" ? "image" : (att.payload?.mime_type || att.type),
              url: att.payload?.url || "",
              thumbnailUrl: att.payload?.url || "",
              originalName: att.payload?.name || att.type,
            }));

            if (!text) {
              text = attachments[0]?.type === "image" ? "📷 Sent an image" : "📁 Sent an attachment";
            }
          }

          const metaMessageId = message.mid || null;
          const messageData = {
            roomId,
            platform,
            senderId,
            senderRole: "customer",
            receiverId: "admin",
            text,
            attachments,
            isRead: false,
            metaMessageId,
            createdAt: new Date(timestamp),
            senderName: customerName,
            senderAvatar: customerAvatar,
          };

          // 1. Upsert message into DB by metaMessageId to avoid duplicate
          if (metaMessageId) {
            await msgCollection.updateOne(
              { metaMessageId },
              { $set: messageData },
              { upsert: true }
            );
          } else {
            await msgCollection.insertOne(messageData);
          }

          const customerObj = {
            id: senderId,
            _id: senderId,
            name: customerName,
            userName: customerName,
            avatar: customerAvatar,
          };

          // 2. Upsert Conversation
          const convRes = await conversationCollection.findOneAndUpdate(
            { roomId },
            {
              $set: {
                platform,
                platformId: senderId,
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

          // 3. Emit real-time socket events to staff
          io.to(roomId).emit("receiveMessage", messageData);
          io.to(`fb_${senderId}`).emit("receiveMessage", messageData);
          io.to(senderId).emit("receiveMessage", messageData);
          io.to("admin_global_room").emit("receiveMessage", messageData);
          io.to("admin_global_room").emit("newConversationUpdate", {
            roomId,
            lastMessage: text,
            updatedAt: new Date(timestamp),
            customerId: senderId,
            platform,
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

          // 4. Send dashboard staff notification
          await createAndSendNotification({
            type: "new_message",
            title: `New ${platform === "instagram" ? "Instagram" : "Facebook"} Message`,
            message: `From ${customerName}: "${text.length > 40 ? text.slice(0, 37) + '...' : text}"`,
            link: `/dashboard/inbox/${platform}/${roomId}`,
            recipientRole: "staff",
          });
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error("Error processing Meta webhook:", error);
    return res.status(500).send("Internal Server Error");
  }
};

/**
 * 3. Send Facebook/Instagram Message from Admin Dashboard
 */
export const sendFBMessage = async (req, res) => {
  try {
    const { roomId, recipientId, text, platform = "facebook" } = req.body;

    if (!recipientId || !text) {
      return res.status(400).json({ success: false, message: "Recipient ID and message text are required" });
    }

    // Call Meta Graph API to send message to customer
    let graphRes;
    try {
      graphRes = await fbApi.post("/me/messages", {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: "RESPONSE",
      });
    } catch (apiErr) {
      console.error("Meta Graph API error:", apiErr.response?.data || apiErr.message);
      return res.status(502).json({
        success: false,
        message: "Failed to deliver message via Meta API",
        error: apiErr.response?.data?.error?.message || apiErr.message,
      });
    }

    const messageData = {
      roomId: roomId || `${platform === "instagram" ? "ig" : "fb"}_${recipientId}`,
      platform,
      senderId: "admin",
      senderRole: "admin",
      receiverId: recipientId,
      text,
      attachments: [],
      isRead: true,
      metaMessageId: graphRes.data?.message_id,
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
          platform,
        },
      },
      { upsert: true }
    );

    // Emit realtime socket event
    io.to(messageData.roomId).emit("receiveMessage", messageData);
    io.to("admin_global_room").emit("receiveMessage", messageData);

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      data: messageData,
    });
  } catch (error) {
    console.error("Error sending Meta message:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * 4. Fetch Facebook & Instagram conversations
 */
export const getConversations = async (req, res) => {
  try {
    const platform = req.query.platform || "facebook";
    const filter = platform === "all" ? { platform: { $in: ["facebook", "instagram"] } } : { platform };

    const conversations = await conversationCollection
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    return res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};

/**
 * 5. Sync Past / Historical Facebook Conversations (Paginated via Meta Cursors & Target Room)
 */
export const syncFacebookConversations = async (req, res) => {
  try {
    const pageId = process.env.FB_PAGE_ID;
    const accessToken = process.env.FB_ACCESS_TOKEN;

    if (!pageId || !accessToken) {
      return res.status(503).json({
        success: false,
        message: "FB_PAGE_ID or FB_ACCESS_TOKEN is not configured in backend .env",
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const after = req.query.after || "";
    const targetRoomId = req.query.roomId || req.body?.roomId || "";

    const params = {
      fields: "id,snippet,updated_time,participants{id,name,email,picture},senders{id,name,email,picture},unread_count,messages.limit(25){id,message,created_time,from,to,attachments}",
      limit,
    };
    if (after) {
      params.after = after;
    }
    if (targetRoomId) {
      const psid = String(targetRoomId).replace(/^fb_/, "");
      if (psid) {
        params.user_id = psid;
      }
    }

    let fbRes;
    try {
      fbRes = await fbApi.get(`/${pageId}/conversations`, { params });
    } catch (apiErr) {
      // If user_id filter failed (e.g. Meta app permission limitation), fallback without user_id
      if (params.user_id) {
        try {
          delete params.user_id;
          fbRes = await fbApi.get(`/${pageId}/conversations`, { params });
        } catch (fallbackErr) {
          console.error("Meta Graph API sync error:", fallbackErr.response?.data || fallbackErr.message);
          return res.status(502).json({
            success: false,
            message: "Failed to fetch conversations from Facebook Graph API",
            error: fallbackErr.response?.data?.error?.message || fallbackErr.message,
          });
        }
      } else {
        console.error("Meta Graph API sync error:", apiErr.response?.data || apiErr.message);
        return res.status(502).json({
          success: false,
          message: "Failed to fetch conversations from Facebook Graph API",
          error: apiErr.response?.data?.error?.message || apiErr.message,
        });
      }
    }

    const { data: rawConversations = [], paging } = fbRes.data || {};
    let syncedCount = 0;
    let syncedMessagesCount = 0;

    // Pre-fetch existing conversations in a single batch query
    const candidateRoomIds = [];
    for (const conv of rawConversations) {
      const participants = conv.participants?.data || conv.senders?.data || [];
      const customer =
        participants.find((p) => p.id !== pageId) || participants[0];
      if (customer?.id) {
        candidateRoomIds.push(`fb_${customer.id}`);
      }
    }

    const existingConvsArr =
      candidateRoomIds.length > 0
        ? await conversationCollection
            .find({ roomId: { $in: candidateRoomIds } })
            .toArray()
        : [];
    const existingConvMap = new Map(
      existingConvsArr.map((c) => [c.roomId, c])
    );

    for (const conv of rawConversations) {
      // Find customer participant (the one who is not the page)
      const participants = conv.participants?.data || conv.senders?.data || [];
      const customer = participants.find((p) => p.id !== pageId) || participants[0];

      if (!customer?.id) continue;

      const customerPSID = customer.id;
      let customerName = customer.name || "Facebook User";
      const roomId = `fb_${customerPSID}`;
      const updatedAt = conv.updated_time ? new Date(conv.updated_time) : new Date();

      // Check existing conversation from pre-fetched map
      const existingConv = existingConvMap.get(roomId);
      let customerAvatar =
        existingConv?.customer?.avatar ||
        customer.picture?.data?.url ||
        customer.picture ||
        null;

      // Only query Meta profile API if we don't already have a resolved name/avatar in DB
      const hasResolvedNameInDb =
        existingConv?.customer?.name &&
        !existingConv.customer.name.startsWith("Facebook User");
      if (hasResolvedNameInDb && customerName === "Facebook User") {
        customerName = existingConv.customer.name;
      }

      if (!existingConv && (!customerAvatar || customerName === "Facebook User")) {
        const profile = await getFBUserProfile(customerPSID);
        if (profile.avatar) {
          customerAvatar = profile.avatar;
        }
        if (!customerName || customerName === "Facebook User") {
          customerName = profile.name;
        }
      }

      const customerObj = {
        id: customerPSID,
        _id: customerPSID,
        name: customerName,
        userName: customerName,
        avatar: customerAvatar || null,
      };

      // 1. Upsert Conversation
      await conversationCollection.updateOne(
        { roomId },
        {
          $set: {
            platform: "facebook",
            platformId: customerPSID,
            lastMessage: conv.snippet || "Facebook Conversation",
            updatedAt,
            customer: customerObj,
            metaConversationId: conv.id,
          },
          $setOnInsert: {
            createdAt: updatedAt,
          },
        },
        { upsert: true }
      );
      syncedCount++;

      // 2. Batch check & upsert historical messages for this conversation
      const messagesList = (conv.messages?.data || []).filter((m) => m?.id);
      const newlyInsertedMessages = [];

      if (messagesList.length > 0) {
        const metaIds = messagesList.map((m) => m.id);
        const existingMsgs = await msgCollection
          .find(
            {
              $or: [
                { metaMessageId: { $in: metaIds } },
                { externalMetaId: { $in: metaIds } },
              ],
            },
            { projection: { _id: 1, metaMessageId: 1, externalMetaId: 1 } }
          )
          .toArray();

        const knownMetaIds = new Set();
        for (const em of existingMsgs) {
          if (em.metaMessageId) knownMetaIds.add(em.metaMessageId);
          if (em.externalMetaId) knownMetaIds.add(em.externalMetaId);
        }

        const bulkOps = [];
        for (const msg of messagesList) {
          if (knownMetaIds.has(msg.id)) {
            syncedMessagesCount++;
            continue;
          }

          const isCustomer = msg.from?.id === customerPSID;
          const msgCreatedAt = msg.created_time
            ? new Date(msg.created_time)
            : new Date();

          let attachments = [];
          if (msg.attachments?.data?.length > 0) {
            attachments = msg.attachments.data.map((att) => ({
              type: att.mime_type || "image",
              url: att.image_data?.url || att.file_url || "",
              thumbnailUrl:
                att.image_data?.preview_url || att.image_data?.url || "",
              originalName: att.name || "Attachment",
            }));
          }

          const msgData = {
            roomId,
            platform: "facebook",
            senderId: isCustomer ? customerPSID : "admin",
            senderRole: isCustomer ? "customer" : "admin",
            receiverId: isCustomer ? "admin" : customerPSID,
            text:
              msg.message || (attachments.length > 0 ? "📷 Attachment" : ""),
            attachments,
            isRead: isCustomer ? false : true,
            metaMessageId: msg.id,
            createdAt: msgCreatedAt,
            senderName: isCustomer ? customerName : "Admin",
            senderAvatar: isCustomer ? customerAvatar : null,
          };

          bulkOps.push({
            updateOne: {
              filter: { metaMessageId: msg.id },
              update: { $setOnInsert: msgData },
              upsert: true,
            },
          });
          newlyInsertedMessages.push(msgData);
          syncedMessagesCount++;
        }

        if (bulkOps.length > 0) {
          await msgCollection.bulkWrite(bulkOps, { ordered: false });
        }
      }

      // Only emit socket events if brand-new messages or a brand-new conversation were discovered
      if (newlyInsertedMessages.length > 0 || !existingConv) {
        for (const newMsg of newlyInsertedMessages) {
          io.to(roomId).emit("receiveMessage", newMsg);
          io.to(`fb_${customerPSID}`).emit("receiveMessage", newMsg);
          io.to(customerPSID).emit("receiveMessage", newMsg);
          io.to("admin_global_room").emit("receiveMessage", newMsg);
        }

        io.to("admin_global_room").emit("newConversationUpdate", {
          roomId,
          lastMessage: conv.snippet || "Facebook Conversation",
          updatedAt,
          customerId: customerPSID,
          platform: "facebook",
          customer: customerObj,
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
    }

    return res.status(200).json({
      success: true,
      message: `Successfully synced ${syncedCount} conversations and ${syncedMessagesCount} messages from Facebook.`,
      data: {
        syncedCount,
        syncedMessagesCount,
        hasNextPage: Boolean(paging?.next && paging?.cursors?.after),
        nextCursor: paging?.cursors?.after || null,
        prevCursor: paging?.cursors?.before || null,
      },
    });
  } catch (error) {
    console.error("Error in syncFacebookConversations:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
