import client from "../config/db.js";

const serviceCollection = client.db("nexoro").collection("Services");
await serviceCollection.createIndex({ slug: 1 }, { unique: true });

//create new client
export const createService = async (req, res) => {
  const { title, slug, shortDes, longDes } = req.body;

  const { filename, path } = req.file;
  const added = new Date();
  try {
    await serviceCollection.insertOne({
      title,
      slug,
      shortDes,
      longDes,
      icon: path,
      public_id: filename,
      added,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "Service already exists" });
    }
    console.error("Create service error:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to create service" });
  }
};

// Get all Services
export const getAllServices = async (req, res) => {
  const services = await serviceCollection.find().toArray();
  res.send(services);
};

// Delete services
export const deleteServices = async (req, res) => {
  const slug = req.params.slug;
  try {
    const result = await serviceCollection.deleteOne({ slug });
    if (result.deletedCount > 0) {
      return res.send({
        success: true,
        message: "Service deleted successfully",
      });
    } else {
      return res.send({
        success: false,
        message: "Service not found in MongoDB",
      });
    }
  } catch (error) {
    console.error("Delete error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete Service" });
  }
};
