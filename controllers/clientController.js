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