import client from "../config/db.js";
import admin from "../admin/firebase.config.js";
import { ObjectId } from "mongodb";

const userCollection = client.db("nexoro").collection("Users");
await userCollection.createIndex({ email: 1 }, { unique: true });

// Create new user
export const createUser = async (req, res) => {
  const { userName, email, google } = req.body;
  const role = "customer";
  const joined = new Date();
  try {
    await userCollection.insertOne({ userName, email, google, role, joined });
    res.status(200).send({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "User already exists" });
    }
    console.error("Create user error:", error);
    res.status(500).send({ success: false, message: "Failed to create user" });
  }
};

// Get single user
export const getUser = async (req, res) => {
  const email = req.params.email;
  try {
    const user = await userCollection.findOne({ email });
    if (user) {
      return res.status(200).json({ success: true, user });
    } else {
      return res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Get all customers
export const getAllUsers = async (req, res) => {
  try {
    const customer = await userCollection.find({ role: "customer" }).toArray();
    res.status(200).json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch customers", error });
  }
};

//Get all members
export const getAllMembers = async (req, res) => {
  try {
    const members = await userCollection.find({ role: "member" }).toArray();
    res.status(200).json(members);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch members", error });
  }
};

// Promote User
export const promoteUser = async (req, res) => {
  const email = req.params.email;
  try {
    const user = await userCollection.updateOne(
      { email },
      { $set: { role: "member" } }
    );
    if (user.modifiedCount > 0) {
      res.status(200).send({ success: true, message: "User promoted to member" });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
}
// demote Member
export const demoteMember = async (req, res) => {
  const email = req.params.email;
  try {
    const user = await userCollection.updateOne(
      { email },
      { $set: { role: "customer" } }
    );
    if (user.modifiedCount > 0) {
      res.status(200).send({ success: true, message: "Member demoted to customer" });
    } else {
      res.status(404).send({ success: false, message: "Member not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
}

// Update user
export const updateUser = async (req, res) => {
  const email = req.params.email;
  const updatedData = req.body;
  try {
    const result = await userCollection.updateOne(
      { email },
      { $set: updatedData }
    );
    if (result.modifiedCount > 0) {
      res.status(200).send({ success: true, message: "User updated" });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  const email = req.params.remove;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(userRecord.uid);
    const result = await userCollection.deleteOne({ email });
    if (result.deletedCount > 0) {
      return res.send({ success: true, message: "User deleted successfully" });
    } else {
      return res.send({ success: false, message: "User not found in MongoDB" });
    }
  } catch (error) {
    console.error("Delete error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete user" });
  }
};

//create order
export const createOrder = async (req, res) => {
  const { email, slug, id } = req.params
  try {
    const user = await userCollection.updateOne(
      { email },
      { $push: { order: { _id: new ObjectId(), service: slug, plan: new ObjectId(id), added: new Date() } } }
    );
    if (user.modifiedCount > 0) {
      res.status(200).send({ success: true, message: "Order Created" });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Order error:", error)
    return res.status(500).send({ success: false, message: "Failed to create order" })
  }
}