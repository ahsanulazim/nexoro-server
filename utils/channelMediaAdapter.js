/**
 * Channel Media Adapter for normalizing inbound & translating outbound attachments
 * across Web, Facebook Messenger, Instagram DMs, and WhatsApp Business.
 */

export const CHANNEL_CONSTRAINTS = {
  web: {
    maxFilesPerMessage: 10,
    maxImageSize: 10 * 1024 * 1024,
    maxVideoSize: 50 * 1024 * 1024,
    maxAudioSize: 25 * 1024 * 1024,
    maxDocSize: 25 * 1024 * 1024,
    supportedCategories: ["image", "video", "audio", "document"],
  },
  facebook: {
    maxFilesPerMessage: 10,
    maxImageSize: 10 * 1024 * 1024,
    maxVideoSize: 25 * 1024 * 1024,
    maxAudioSize: 25 * 1024 * 1024,
    maxDocSize: 25 * 1024 * 1024,
    supportedCategories: ["image", "video", "audio", "document"],
  },
  instagram: {
    maxFilesPerMessage: 10,
    maxImageSize: 8 * 1024 * 1024,
    maxVideoSize: 25 * 1024 * 1024,
    maxAudioSize: 25 * 1024 * 1024,
    maxDocSize: 25 * 1024 * 1024,
    supportedCategories: ["image", "video", "audio", "document"],
  },
  whatsapp: {
    maxFilesPerMessage: 10,
    maxImageSize: 5 * 1024 * 1024,
    maxVideoSize: 16 * 1024 * 1024,
    maxAudioSize: 16 * 1024 * 1024,
    maxDocSize: 100 * 1024 * 1024,
    supportedCategories: ["image", "video", "audio", "document"],
  },
};

export const DISALLOWED_EXTENSIONS = [
  "exe", "bat", "cmd", "sh", "php", "js", "vbs", "msi", "jar", "apk", "com", "scr"
];

/**
 * Checks if a filename has an executable or unsafe extension.
 */
export const isUnsafeFile = (filename = "") => {
  if (!filename) return false;
  const clean = filename.toLowerCase().split("?")[0].split("#")[0];
  const ext = clean.split(".").pop();
  return DISALLOWED_EXTENSIONS.includes(ext);
};

/**
 * Categorizes MIME types & extensions into 'image', 'video', 'audio', or 'document'.
 */
export const categorizeMime = (mimeType = "", filename = "") => {
  const mime = (mimeType || "").toLowerCase();
  const ext = (filename || "").toLowerCase().split(".").pop() || "";

  if (
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(ext)
  ) {
    return "image";
  }
  if (
    mime.startsWith("video/") ||
    ["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)
  ) {
    return "video";
  }
  if (
    mime.startsWith("audio/") ||
    mime === "voice" ||
    ["mp3", "wav", "ogg", "m4a", "aac", "opus"].includes(ext)
  ) {
    return "audio";
  }
  return "document";
};

/**
 * Validates attachment against channel restrictions.
 */
export const validateAttachmentForChannel = (fileOrAttachment, platform = "web") => {
  const filename = fileOrAttachment.originalName || fileOrAttachment.originalname || fileOrAttachment.name || "";
  const size = Number(fileOrAttachment.size || 0);
  const mimeType = fileOrAttachment.mimeType || fileOrAttachment.mimetype || fileOrAttachment.type || "";

  if (isUnsafeFile(filename)) {
    return {
      valid: false,
      error: `File ${filename} has an executable extension and cannot be uploaded.`,
    };
  }

  const constraints = CHANNEL_CONSTRAINTS[platform] || CHANNEL_CONSTRAINTS.web;
  const category = categorizeMime(mimeType, filename);

  let limit = constraints.maxDocSize;
  if (category === "image") limit = constraints.maxImageSize;
  else if (category === "video") limit = constraints.maxVideoSize;
  else if (category === "audio") limit = constraints.maxAudioSize;

  if (size > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    return {
      valid: false,
      error: `Attachment "${filename}" exceeds the ${limitMB}MB limit for ${platform}.`,
    };
  }

  return { valid: true, category };
};

import { fbApi } from "./axios/fbApi.js";

/**
 * Formats an outgoing Meta (Facebook Messenger / Instagram) attachment message payload.
 */
export const formatMetaAttachmentPayload = (recipientId, attachment, messagingType = "RESPONSE") => {
  const category = attachment.category || categorizeMime(attachment.mimeType, attachment.originalName);
  let metaType = "file";
  if (category === "image") metaType = "image";
  else if (category === "video") metaType = "video";
  else if (category === "audio") metaType = "audio";

  return {
    recipient: { id: recipientId },
    messaging_type: messagingType,
    message: {
      attachment: {
        type: metaType,
        payload: {
          url: attachment.url,
          is_reusable: true,
        },
      },
    },
  };
};

/**
 * Formats an attachment into the inner message object for Meta Graph API.
 */
export const formatMetaAttachmentContent = (attachment) => {
  const category = attachment.category || categorizeMime(attachment.mimeType, attachment.originalName);
  let metaType = "file";
  if (category === "image") metaType = "image";
  else if (category === "video") metaType = "video";
  else if (category === "audio") metaType = "audio";

  return {
    attachment: {
      type: metaType,
      payload: {
        url: attachment.url,
        is_reusable: true,
      },
    },
  };
};

/**
 * Sends a message or media to Meta (Facebook Messenger / Instagram) with automatic
 * HUMAN_AGENT tag fallback if outside the standard 24-hour response window.
 */
export const sendMetaMessage = async (recipientId, messageContent) => {
  try {
    // 1. Try standard RESPONSE within 24-hour window
    const res = await fbApi.post("/me/messages", {
      recipient: { id: recipientId },
      message: messageContent,
      messaging_type: "RESPONSE",
    });
    return { success: true, messageId: res.data?.message_id };
  } catch (err) {
    const errData = err.response?.data?.error;
    // Check if error is #10 window expired (code 10, error_subcode 2018278)
    if (errData?.code === 10 || errData?.error_subcode === 2018278) {
      console.warn("Facebook 24-hour window expired. Retrying with HUMAN_AGENT message tag...");
      try {
        const retryRes = await fbApi.post("/me/messages", {
          recipient: { id: recipientId },
          message: messageContent,
          messaging_type: "MESSAGE_TAG",
          tag: "HUMAN_AGENT",
        });
        return { success: true, messageId: retryRes.data?.message_id };
      } catch (retryErr) {
        const retryErrData = retryErr.response?.data?.error;
        console.error("Meta HUMAN_AGENT retry failed:", retryErrData || retryErr.message);
        return {
          success: false,
          code: "OUTSIDE_ALLOWED_WINDOW",
          message:
            "Facebook Policy: The 24-hour response window has expired for this user. The customer must message your Facebook page first before you can send replies.",
          raw: retryErrData,
        };
      }
    }

    console.error("Meta API error:", errData || err.message);
    return {
      success: false,
      code: "META_API_ERROR",
      message: errData?.message || err.message,
      raw: errData,
    };
  }
};

/**
 * Formats an outgoing WhatsApp Cloud API media payload.
 */
export const formatWhatsAppMediaPayload = (recipientPhone, attachment, caption = "") => {
  const category = attachment.category || categorizeMime(attachment.mimeType, attachment.originalName);
  let waType = "document";
  if (category === "image") waType = "image";
  else if (category === "video") waType = "video";
  else if (category === "audio") waType = "audio";

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientPhone.replace(/[^0-9]/g, ""),
    type: waType,
  };

  if (waType === "document") {
    payload.document = {
      link: attachment.url,
      caption: caption || undefined,
      filename: attachment.originalName || "document",
    };
  } else if (waType === "image") {
    payload.image = {
      link: attachment.url,
      caption: caption || undefined,
    };
  } else if (waType === "video") {
    payload.video = {
      link: attachment.url,
      caption: caption || undefined,
    };
  } else if (waType === "audio") {
    payload.audio = {
      link: attachment.url,
    };
  }

  return payload;
};
