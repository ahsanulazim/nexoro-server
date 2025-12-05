import { ObjectId } from "mongodb";
import client from "../config/db.js";

const clientCollection = client.db("nexoro").collection("Clients");
await clientCollection.createIndex({ email: 1 }, { unique: true });

//create new client
export const createClient = async (req, res) => {
  const { client, company, role, email, country } = req.body;
  const { filename, path } = req.file;
  const joined = new Date();
  try {
    await clientCollection.insertOne({
      client,
      company,
      role,
      email,
      country,
      logo: path,
      public_id: filename,
      joined,
    });
    res.status(200).send({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "Client already exists" });
    }
    console.error("Create client error:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to create client" });
  }
};

// Get all users
export const getAllClients = async (req, res) => {
  const clients = await clientCollection.find().toArray();
  res.send(clients);
};

// delete client
export const deleteClient = async (req, res) => {
  const email = req.params.email;
  try {
    const result = await clientCollection.deleteOne({ email });
    if (result.deletedCount > 0) {
      return res.send({
        success: true,
        message: "Client deleted successfully",
      });
    } else {
      return res.send({
        success: false,
        message: "Client not found in MongoDB",
      });
    }
  } catch (error) {
    console.error("Delete error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete Client" });
  }
};

// update client
export const updateClient = async (req, res) => {
  try {
    const id = req.params.id;

    const { client, company, role, email, country, } = req.body;
    const existingClient = await clientCollection.findOne({ _id: new ObjectId(id) });

    if (!existingClient) {
      return res.status(404).json({ message: "Client not found" });
    }
    const updatedClient = {
      client,
      company,
      role,
      email,
      country,
      joined: new Date(),
    };

    if (req.file) {
      if (existingClient.logo?.public_id) {
        cloudinary.uploader.destroy(existingClient.logo.public_id);
      }
      updatedClient.logo = req.file.path;
      updatedClient.public_id = req.file.filename;
    } else {
      updatedClient.logo = existingClient.logo;
    }

    await clientCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedClient });
    res.status(200).json({ success: true, message: "Client updated successfully" });
  } catch (error) {
    console.error("Update client error:", error);
    res.status(500).json({ success: false, message: "Failed to update client" });
  }
};