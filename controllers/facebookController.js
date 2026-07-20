import { config } from "dotenv";
import { fbApi } from "../utils/axios/fbApi.js";

config();

export const verifyFBWebhook = async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === process.env.FB_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }
    }
    return res.status(403).send("Invalid request");
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return res.status(500).send("Internal Server Error");
  }
};

export const getConversations = async (req, res) => {
  try {
    const apiResponse = await fbApi.get("/me/conversations", {
      params: {
        platform: "messenger",
        fields: "id,updated_time,is_owner",
        limit: 20,
      },
    });

    const fbThreads = apiResponse.data?.data || [];

    // Promise.all ব্যবহার করে প্যারালাল প্রসেসিং
    const formattedChats = await Promise.all(
      fbThreads.map(async (thread) => {
        try {
          const msgRes = await fbApi.get(`/${thread.id}`, {
            params: { fields: "messages,participants" },
          });

          const latestMessageId = msgRes.data?.messages?.data?.[0]?.id;
          const participants = msgRes.data?.participants?.data || [];
          const actualCustomer = participants.find(
            (p) => p.id !== process.env.FB_PAGE_ID,
          );

          let customerInfo = {
            id: actualCustomer?.id || thread.id,
            name: actualCustomer?.name || "Facebook User",
          };

          let lastMessageText = "Sent an attachment";

          if (latestMessageId) {
            const msgDetailsRes = await fbApi.get(`/${latestMessageId}`, {
              params: { fields: "id,message,attachments,shares" },
            });

            const msgData = msgDetailsRes.data;
            if (msgData?.message) {
              lastMessageText = msgData.message;
            } else if (msgData?.attachments?.data?.[0]) {
              const mimeType = msgData.attachments.data[0].mime_type || "";
              lastMessageText = mimeType.includes("image")
                ? "📷 Sent a photo"
                : "📁 Sent a file";
            } else if (msgData?.shares?.data?.[0]) {
              lastMessageText = "🔗 Shared a link";
            }
          }

          return {
            platform: "facebook",
            roomId: thread.id,
            isOwner: thread.is_owner || false,
            updatedAt: thread.updated_time,
            lastMessage: lastMessageText,
            customer: {
              name: customerInfo.name,
              id: customerInfo.id,
              avatar:
                `https://graph.facebook.com/v25.0/${customerInfo.id}/picture?type=large&access_token=${process.env.FB_ACCESS_TOKEN}` ||
                null,
            },
          };
        } catch (error) {
          console.error(`Error processing thread ${thread.id}:`, error.message);
          return null; // কোনো একটা চ্যাটে এরর হলে null রিটার্ন করবে যেন বাকিগুলো ক্র্যাশ না করে
        }
      }),
    );

    // null ভ্যালুগুলো ফিল্টার করে বাদ দেওয়া
    const validChats = formattedChats.filter((chat) => chat !== null);

    return res.status(200).json({ success: true, data: validChats });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};
