import { config } from "dotenv";

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

export const handleFBWebhookEvent = async (req, res) => {
  try {
    const events = req.body.entry;
    if (!events) {
      return res.status(400).send("No events received");
    }

    for (const event of events) {
      if (event.messaging) {
        for (const messageEvent of event.messaging) {
          if (messageEvent.message) {
            //TextMessage
            if (messageEvent.message.text) {
              const senderId = messageEvent.sender.id;
              const messageText = messageEvent.message.text;

              // TODO: database connection
              await saveMessageToDatabase(senderId, messageText);
            }
            //Image
            if (messageEvent.message.attachments?.[0].type === "image") {
              const senderId = messageEvent.sender.id;
              const imageUrl = messageEvent.message.attachments[0].payload.url;

              await saveMessageToDatabase(senderId, null, imageUrl);
            }
          }
        }
      }
    }
    res.status(200).send("Event processed successfully");
  } catch (error) {
    console.error("Webhook event handling failed:", error);
    return res.status(500).send("Internal Server Error");
  }
};
