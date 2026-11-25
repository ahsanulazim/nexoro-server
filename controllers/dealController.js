import crypto from "crypto";
import axios from "axios";
import { ObjectId } from "mongodb";
import client from "../config/db.js";
import { io } from "../socket/socket.js";
import { getNextOrderId } from "./orderController.js";
import { convertToBDT } from "../utils/currencyHelper.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";
import { sendMetaMessage } from "../utils/channelMediaAdapter.js";
import {
  findMatchingClient,
  isPlaceholderClientEmail,
} from "./messageController.js";

const dealCollection = client.db("nexoro").collection("Deals");
const orderCollection = client.db("nexoro").collection("Orders");
const clientCollection = client.db("nexoro").collection("Clients");
const conversationCollection = client.db("nexoro").collection("Conversations");
const msgCollection = client.db("nexoro").collection("Messages");
const serviceCollection = client.db("nexoro").collection("Services");

// Helper: Generate EPS HMAC Hash
const generateEPSHash = (data, key) => {
  return crypto
    .createHmac("sha512", Buffer.from(key, "utf8"))
    .update(data)
    .digest("base64");
};

// Helper: Fetch EPS Token
const getEPSToken = async () => {
  const xHash = generateEPSHash(
    process.env.EPS_USERNAME,
    process.env.EPS_HASH_KEY,
  );
  const response = await fetch(`${process.env.EPS_URL}/Auth/GetToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hash": xHash,
    },
    body: JSON.stringify({
      userName: process.env.EPS_USERNAME,
      password: process.env.EPS_PASSWORD,
    }),
  });
  const data = await response.json();
  return data?.token;
};

// Helper: Send Outbound Message to Channel (WhatsApp / Facebook)
const sendOutboundChannelMessage = async ({
  platform,
  roomId,
  text,
  conversation,
}) => {
  try {
    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");

    if (platform === "facebook" || platform === "instagram") {
      const recipientId =
        conversation?.platformId ||
        conversation?.customer?.bsuid ||
        conversation?.customer?.id ||
        cleanId;
      await sendMetaMessage(recipientId, { text });
    } else if (platform === "whatsapp") {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken =
        process.env.WHATSAPP_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;

      if (phoneNumberId && accessToken) {
        let waTarget = cleanId;
        if (
          conversation?.customer?.phone &&
          /^\+?[0-9]+$/.test(conversation.customer.phone)
        ) {
          waTarget = conversation.customer.phone;
        } else if (conversation?.platformId) {
          waTarget = conversation.platformId;
        }
        waTarget = String(waTarget).replace(/[^0-9]/g, "");

        await axios.post(
          `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,
          {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: waTarget,
            type: "text",
            text: { preview_url: true, body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          },
        );
      }
    }
  } catch (err) {
    console.warn("Outbound channel message warning:", err.message);
  }
};

/**
 * 1. Create a Custom Deal Payment Link from Unified Inbox
 * POST /payment/deals/create-link
 */
export const createDealPaymentLink = async (req, res) => {
  try {
    const {
      roomId,
      clientId: requestedClientId,
      clientName,
      company,
      clientRole,
      clientEmail,
      clientPhone,
      country,
      slug = "custom",
      planId,
      serviceName,
      servicePrice,
      discount = 0,
      amount,
      deadline,
      assignToSelf,
      assignedTo,
      rewardPoints,
      orderNote,
      expiresInDays = 7,
    } = req.body;

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }

    const cleanId = String(roomId).replace(/^(fb_|ig_|wa_|room_)/, "");
    const conversation = await conversationCollection.findOne({
      roomId: {
        $in: [
          roomId,
          cleanId,
          `fb_${cleanId}`,
          `ig_${cleanId}`,
          `wa_${cleanId}`,
          `room_${cleanId}`,
        ],
      },
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
    const resolvedName =
      (clientName || "").trim() ||
      conversation?.customer?.name ||
      conversation?.customer?.userName ||
      "Customer";
    const resolvedPhone =
      (clientPhone || "").trim() || conversation?.customer?.phone || "";
    const cleanEmail = (clientEmail || "").trim().toLowerCase();

    // Calculate Price and Amount
    let price = 0;
    let title = slug;
    let discountNum = Number(discount) || 0;
    let finalPayable = 0;

    if (slug === "custom") {
      price = Number(servicePrice) || 0;
      title = (serviceName || "").trim() || "Custom Service";
      const calculated = Math.max(0, price - discountNum);
      finalPayable =
        Number(amount) && Number(amount) > 0 ? Number(amount) : calculated;
    } else {
      const serviceData = await serviceCollection.findOne({ slug });
      const planData = serviceData?.plans?.find(
        (plan) => plan.id?.toString() === planId?.toString(),
      );
      const planPriceUSD = Number(planData?.price) || 0;
      price = await convertToBDT(planPriceUSD);
      title = serviceData?.title || slug;
      if (discountNum > 0) {
        discountNum = await convertToBDT(discountNum);
      }
      const calculated = Math.max(0, price - discountNum);
      finalPayable =
        Number(amount) && Number(amount) > 0 ? Number(amount) : calculated;
    }

    if (!finalPayable || finalPayable <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payable amount must be greater than 0",
      });
    }

    const creatorUser = req.user;
    const createdBy =
      creatorUser?.name ||
      creatorUser?.displayName ||
      creatorUser?.email ||
      "Staff";

    let initialAssignedTo = null;
    if (assignToSelf === true || assignToSelf === "true") {
      initialAssignedTo = creatorUser?._id ? creatorUser._id.toString() : null;
    } else if (assignedTo) {
      initialAssignedTo = String(assignedTo);
    }

    const dealId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    );

    const dealDoc = {
      dealId,
      roomId: canonicalRoomId,
      platform,
      clientId: requestedClientId || null,
      clientName: resolvedName,
      company: (company || "").trim() || "Individual / Self",
      clientRole: (clientRole || "").trim() || "Client",
      clientEmail: cleanEmail,
      clientPhone: resolvedPhone,
      country: country || "Bangladesh",
      slug,
      planId: slug === "custom" ? null : planId,
      serviceName: title,
      servicePrice: price,
      discount: discountNum,
      amount: finalPayable,
      deadline: deadline ? new Date(deadline) : null,
      assignedTo: initialAssignedTo,
      rewardPoints: Number(rewardPoints) || 5,
      orderNote: (orderNote || "").trim(),
      status: "Pending", // "Pending" | "Paid" | "Expired" | "Cancelled"
      createdBy,
      createdById: creatorUser?._id ? String(creatorUser._id) : null,
      createdAt: new Date(),
      expiresAt,
    };

    await dealCollection.insertOne(dealDoc);

    const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
    const paymentUrl = `${frontendBase}/pay/${dealId}`;

    // Create a message in the chat timeline
    const messageText = `Order Details\n\n📌 Service: ${title}\n💰 Total Amount: BDT ${finalPayable.toLocaleString()}\n\n👉 Complete payment securely here:\n${paymentUrl}`;

    const chatMsg = {
      roomId: canonicalRoomId,
      platform,
      senderId: creatorUser?._id ? String(creatorUser._id) : "admin",
      senderRole: "admin",
      senderName: createdBy,
      type: "deal_link",
      text: messageText,
      deal: {
        dealId,
        serviceName: title,
        amount: finalPayable,
        paymentUrl,
        status: "Pending",
      },
      attachments: [],
      isRead: true,
      createdAt: new Date(),
    };

    const insertedMsg = await msgCollection.insertOne(chatMsg);
    const savedMsg = { ...chatMsg, _id: insertedMsg.insertedId };

    // Emit via Socket.io to all room variations
    io.to(canonicalRoomId).emit("receiveMessage", savedMsg);
    if (roomId && roomId !== canonicalRoomId) {
      io.to(roomId).emit("receiveMessage", savedMsg);
    }
    if (cleanId && cleanId !== canonicalRoomId && cleanId !== roomId) {
      io.to(cleanId).emit("receiveMessage", savedMsg);
    }
    io.to("admin_global_room").emit("receiveMessage", savedMsg);

    // Send Outbound Message to Social Channels (WhatsApp, Messenger)
    await sendOutboundChannelMessage({
      platform,
      roomId: canonicalRoomId,
      text: messageText,
      conversation,
    });

    return res.status(201).json({
      success: true,
      message: "Custom deal payment link created and sent to chat!",
      data: {
        dealId,
        paymentUrl,
        deal: dealDoc,
        message: savedMsg,
      },
    });
  } catch (error) {
    console.error("Error creating deal payment link:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create deal payment link: " + error.message,
    });
  }
};

/**
 * 2. Get Deal Details for Public Checkout Page
 * GET /payment/deals/:dealId
 */
export const getDealDetails = async (req, res) => {
  try {
    const { dealId } = req.params;
    if (!dealId) {
      return res
        .status(400)
        .json({ success: false, message: "Deal ID is required" });
    }

    const deal = await dealCollection.findOne({ dealId });
    if (!deal) {
      return res
        .status(404)
        .json({ success: false, message: "Deal not found" });
    }

    const isExpired = deal.expiresAt && new Date() > new Date(deal.expiresAt);

    return res.status(200).json({
      success: true,
      data: {
        dealId: deal.dealId,
        serviceName: deal.serviceName,
        servicePrice: deal.servicePrice,
        discount: deal.discount,
        amount: deal.amount,
        clientName: deal.clientName,
        clientEmail: deal.clientEmail,
        clientPhone: deal.clientPhone,
        company: deal.company,
        country: deal.country,
        orderNote: deal.orderNote,
        deadline: deal.deadline,
        status:
          isExpired && deal.status === "Pending" ? "Expired" : deal.status,
        isExpired,
        paidAt: deal.paidAt || null,
        orderId: deal.orderId || null,
        createdAt: deal.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching deal details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deal details: " + error.message,
    });
  }
};

/**
 * 3. Initialize EPS Payment for Deal
 * POST /payment/deals/:dealId/pay-eps
 */
export const initializeDealEPS = async (req, res) => {
  try {
    const { dealId } = req.params;
    const deal = await dealCollection.findOne({ dealId });

    if (!deal) {
      return res
        .status(404)
        .json({ success: false, message: "Deal not found" });
    }

    if (deal.status === "Paid") {
      return res.status(400).json({
        success: false,
        message: "This deal has already been paid and confirmed.",
      });
    }

    if (deal.expiresAt && new Date() > new Date(deal.expiresAt)) {
      return res.status(400).json({
        success: false,
        message: "This payment link has expired. Please contact support.",
      });
    }

    // Get EPS Token
    const token = await getEPSToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        message: "Failed to authenticate with EPS payment gateway",
      });
    }

    const merchantTransactionId = `deal_${Date.now()}`;
    const xHash = generateEPSHash(
      merchantTransactionId,
      process.env.EPS_HASH_KEY,
    );

    const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
    const successUrl = `${frontendBase}/pay/${dealId}/success?merchantTransactionId=${merchantTransactionId}`;
    const failUrl = `${frontendBase}/pay/${dealId}?status=failed`;
    const cancelUrl = `${frontendBase}/pay/${dealId}?status=cancelled`;

    const epsPayload = {
      merchantId: process.env.EPS_MERCHANT_ID,
      storeId: process.env.EPS_STORE_ID,
      CustomerOrderId: deal.dealId,
      merchantTransactionId,
      transactionTypeId: 1,
      totalAmount: deal.amount,
      successUrl,
      failUrl,
      cancelUrl,
      customerName: deal.clientName || "Customer",
      customerEmail: deal.clientEmail || "client@nexoro.com",
      customerAddress: deal.company || "Dhaka",
      customerCity: "Dhaka",
      customerState: "Dhaka",
      customerPostcode: "1200",
      customerCountry: deal.country || "Bangladesh",
      customerPhone: deal.clientPhone || "01700000000",
      productName: deal.serviceName || "Custom Deal Service",
    };

    const response = await fetch(
      `${process.env.EPS_URL}/EPSEngine/InitializeEPS`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hash": xHash,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(epsPayload),
      },
    );

    const epsData = await response.json();

    // Store transaction ID and token on deal for verification
    await dealCollection.updateOne(
      { dealId },
      {
        $set: {
          lastMerchantTransactionId: merchantTransactionId,
          lastEpsToken: token,
          updatedAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      success: true,
      redirectUrl: epsData?.RedirectURL || epsData?.redirectUrl,
      epsData,
    });
  } catch (error) {
    console.error("Error initializing EPS deal payment:", error);
    return res.status(500).json({
      success: false,
      message: "Payment Initialization Failed: " + error.message,
    });
  }
};

/**
 * 4. Verify & Confirm Order from EPS Payment for Deal
 * GET /payment/deals/:dealId/confirm-eps
 */
export const confirmDealEPS = async (req, res) => {
  try {
    const { dealId } = req.params;
    const { merchantTransactionId } = req.query;

    const deal = await dealCollection.findOne({ dealId });
    if (!deal) {
      return res
        .status(404)
        .json({ success: false, message: "Deal not found" });
    }

    // Idempotency: If already paid, return existing order info
    if (deal.status === "Paid" && deal.orderId) {
      return res.status(200).json({
        success: true,
        alreadyPaid: true,
        orderId: deal.orderId,
        message: "Payment already verified and order confirmed.",
      });
    }

    const txId = merchantTransactionId || deal.lastMerchantTransactionId;
    if (!txId) {
      return res.status(400).json({
        success: false,
        message: "Merchant transaction ID is required for verification",
      });
    }

    // Get fresh token if needed
    const token = await getEPSToken();
    const xHash = generateEPSHash(txId, process.env.EPS_HASH_KEY);

    const epsCheckRes = await fetch(
      `${process.env.EPS_URL}/EPSEngine/CheckMerchantTransactionStatus?merchantTransactionId=${txId}`,
      {
        method: "GET",
        headers: {
          "x-hash": xHash,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    const epsStatusData = await epsCheckRes.json();

    const isSuccess =
      epsStatusData?.Status === "Success" ||
      epsStatusData?.status === "Success" ||
      epsStatusData?.StatusCode === "00" ||
      epsStatusData?.statusCode === "00";

    if (!isSuccess) {
      return res.status(400).json({
        success: false,
        message:
          epsStatusData?.Status || "Payment verification failed with EPS.",
        epsData: epsStatusData,
      });
    }

    // --- STEP A: Find or Create Client ---
    const canonicalRoomId = deal.roomId;
    const cleanId = String(canonicalRoomId).replace(/^(fb_|ig_|wa_|room_)/, "");
    const cleanEmail = (deal.clientEmail || "").trim().toLowerCase();
    const isCleanIdDigits = /^\+?[0-9]+$/.test(cleanId);

    const conversation = await conversationCollection.findOne({
      roomId: {
        $in: [
          canonicalRoomId,
          cleanId,
          `fb_${cleanId}`,
          `ig_${cleanId}`,
          `wa_${cleanId}`,
          `room_${cleanId}`,
        ],
      },
    });

    let existingClient = await findMatchingClient({
      clientId: deal.clientId || conversation?.clientId,
      email: cleanEmail,
      phone: deal.clientPhone,
      roomId: canonicalRoomId,
      platformId: conversation?.platformId || cleanId,
      bsuid:
        conversation?.customer?.bsuid || (!isCleanIdDigits ? cleanId : null),
    });

    let finalClient = null;
    let clientWasCreated = false;

    if (existingClient) {
      const updatedFields = {
        name: deal.clientName || existingClient.name,
        company: deal.company || existingClient.company,
        role: deal.clientRole || existingClient.role || "Client",
        phone: deal.clientPhone || existingClient.phone,
        country: deal.country || existingClient.country,
      };
      if (cleanEmail && !isPlaceholderClientEmail(cleanEmail)) {
        updatedFields.email = cleanEmail;
        updatedFields.isPlaceholderEmail = false;
      }
      await clientCollection.updateOne(
        { _id: existingClient._id },
        { $set: updatedFields },
      );
      finalClient = { ...existingClient, ...updatedFields };
    } else {
      const isPlaceholder = !cleanEmail || isPlaceholderClientEmail(cleanEmail);
      const safeCleanId = cleanId.replace(/[^a-zA-Z0-9_-]/g, "") || Date.now();
      const emailToSave = isPlaceholder
        ? `${deal.platform || "web"}_${safeCleanId}@client.nexoro.local`
        : cleanEmail;

      const newClientDoc = {
        name: deal.clientName,
        company: deal.company || "Individual / Self",
        role: deal.clientRole || "Client",
        email: emailToSave,
        isPlaceholderEmail: isPlaceholder,
        phone: deal.clientPhone || "",
        country: deal.country || "Bangladesh",
        slider: false,
        logo: conversation?.customer?.avatar || "",
        public_id: "",
        roomId: canonicalRoomId,
        platform: deal.platform || "web",
        platformId: conversation?.platformId || cleanId,
        userName: conversation?.customer?.userName || null,
        bsuid:
          conversation?.customer?.bsuid ||
          (deal.platform === "whatsapp" && !isCleanIdDigits ? cleanId : null),
        joined: new Date(),
      };

      try {
        const insertRes = await clientCollection.insertOne(newClientDoc);
        finalClient = { ...newClientDoc, _id: insertRes.insertedId };
        clientWasCreated = true;
      } catch (dupErr) {
        if (dupErr.code === 11000) {
          finalClient = await clientCollection.findOne({ email: emailToSave });
        } else {
          throw dupErr;
        }
      }
    }

    const finalClientId = String(finalClient?._id);

    // --- STEP B: Create Confirmed Order ---
    const orderId = await getNextOrderId();
    const newOrderDoc = {
      clientId: finalClientId,
      clientName: deal.clientName,
      roomId: canonicalRoomId,
      platform: deal.platform || "web",
      dealId: deal.dealId,
      orderId,
      service: deal.slug,
      serviceName: deal.serviceName,
      servicePrice: deal.servicePrice,
      planId: deal.planId || null,
      price: deal.servicePrice || deal.amount,
      discount: deal.discount || 0,
      status: deal.assignedTo ? "Processing" : "Pending",
      createdBy: "Customer (Online Payment / EPS)",
      createdByRole: "customer",
      createdById: null,
      assignedTo: deal.assignedTo || null,
      rewardPoints: deal.rewardPoints || 5,
      orderNote: deal.orderNote || "",
      tasks: [],
      amount: deal.amount,
      payment: "Success",
      paymentMethod: epsStatusData?.FinancialEntity || "EPS",
      epsData: epsStatusData,
      deadline: deal.deadline ? new Date(deal.deadline) : null,
      createdAt: new Date(),
    };

    const orderRes = await orderCollection.insertOne(newOrderDoc);

    // --- STEP C: Update Deal Status ---
    await dealCollection.updateOne(
      { dealId },
      {
        $set: {
          status: "Paid",
          paidAt: new Date(),
          orderId,
          orderMongoId: orderRes.insertedId,
          paymentMethod: epsStatusData?.FinancialEntity || "EPS",
          epsVerificationData: epsStatusData,
        },
      },
    );

    // --- STEP D: Update Conversation & Post System Messages ---
    await conversationCollection.updateOne(
      { roomId: canonicalRoomId },
      {
        $set: {
          clientId: finalClientId,
          isClient: true,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    const systemText = `🎉 Payment Received! Customer completed payment of BDT ${deal.amount.toLocaleString()} via EPS (${epsStatusData?.FinancialEntity || "Online"}). Order #${orderId} (${deal.serviceName}) is confirmed!`;

    const sysMsg = {
      roomId: canonicalRoomId,
      platform: deal.platform || "web",
      senderId: "system",
      senderRole: "system",
      type: "deal_paid",
      isSystem: true,
      receiverId: "admin",
      text: systemText,
      deal: {
        dealId,
        orderId,
        amount: deal.amount,
        status: "Paid",
      },
      attachments: [],
      isRead: true,
      createdAt: new Date(),
    };

    const sysMsgRes = await msgCollection.insertOne(sysMsg);
    const savedSysMsg = { ...sysMsg, _id: sysMsgRes.insertedId };

    // Real-time broadcasts
    io.to(canonicalRoomId).emit("receiveMessage", savedSysMsg);
    if (cleanId && cleanId !== canonicalRoomId) {
      io.to(cleanId).emit("receiveMessage", savedSysMsg);
    }
    io.to("admin_global_room").emit("receiveMessage", savedSysMsg);
    io.to("admin_global_room").emit("newConversationUpdate", {
      roomId: canonicalRoomId,
      platform: deal.platform,
      clientId: finalClientId,
      isClient: true,
      updatedAt: new Date(),
    });

    // Send notifications to dashboard
    await createAndSendNotification({
      type: "new_order",
      title: "Online Payment Received & Order Confirmed!",
      message: `Payment of BDT ${deal.amount.toLocaleString()} received for Order #${orderId} (${deal.serviceName}).`,
      link: "/dashboard/orders",
    });

    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err),
    );

    // Send Outbound Confirmation to Social Channels (WhatsApp, Messenger)
    const receiptText = `✅ Payment of BDT ${deal.amount.toLocaleString()} received successfully!\n\nYour order #${orderId} for "${deal.serviceName}" is confirmed. Our team has received your order and will begin work right away. Thank you!`;

    await sendOutboundChannelMessage({
      platform: deal.platform,
      roomId: canonicalRoomId,
      text: receiptText,
      conversation,
    });

    return res.status(200).json({
      success: true,
      message: "Payment successfully verified and order confirmed!",
      orderId,
      deal: {
        ...deal,
        status: "Paid",
        orderId,
      },
    });
  } catch (error) {
    console.error("Error confirming EPS deal payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to confirm deal payment: " + error.message,
    });
  }
};
