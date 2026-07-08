import { ObjectId } from "mongodb";
import client from "../config/db.js";
import { getReceiverSocketId, io } from "../socket/socket.js";

const conversationCollection = client.db("nexoro").collection("Conversations");

export const allConversations = async (req, res) => {
  try {
    const conversations = await conversationCollection.find().toArray();
    res.status(200).send({ success: true, conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to fetch conversations" });
  }
};

//get all messages of a selectedUser
export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await conversationCollection.findOne({
      _id: new ObjectId(conversationId),
    });
    if (!conversation)
      return res
        .status(404)
        .send({ success: false, message: "Conversation not found" });

    res.status(200).send({ success: true, messages: conversation.messages });
  } catch (error) {
    console.error("Get messages error:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to fetch messages" });
  }
};

//send message to selected user
export const sentMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const { senderId, receiverId } = req.query;
    const { filename, path } = req.file;

    const messageData = {
      senderId,
      receiverId,
      message,
      filename,
      path,
      createdAt: new Date(),
    };

    await conversationCollection.updateOne(
      { senderId, receiverId },
      { $push: { messages: messageData } },
      { upsert: true },
    );

    //emit the new message to the receiver socket
    const receiverSocketId = getReceiverSocketId(receiverId);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", messageData);
    }

    res.status(200).send({
      success: true,
      message: "Message sent successfully",
      messageData,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).send({ success: false, message: "Failed to send message" });
  }
};
