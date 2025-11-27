import { ObjectId } from "mongodb";
import client from "../config/db.js";

const msgCollection = client.db("nexoro").collection("Messages");

//create new Massage
export const createMessage = async (req, res) => {
    const { name, company, phone, email, message } = req.body;
    const added = new Date();
    try {
        await msgCollection.insertOne({
            name,
            company,
            phone,
            email,
            read: false,
            message,
            added,
        });
        res.status(200).send({ success: true });
    } catch (error) {
        console.error("Create message error:", error);
        res.status(500).send({ success: false, message: "Failed to create message" });
    }
};

// Get all msgs
export const getAllMessages = async (req, res) => {
    const messages = await msgCollection.find().toArray();
    res.send(messages);
};

// Get single Message
export const getMessage = async (req, res) => {
    const id = req.params.message;
    try {
        const message = await msgCollection.findOne({ _id: new ObjectId(id) });
        if (message) {
            return res.status(200).json({ success: true, message });
        } else {
            return res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (error) {
        console.error("Get message error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};