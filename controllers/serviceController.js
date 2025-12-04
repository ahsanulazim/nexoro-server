import { ObjectId } from "mongodb";
import client from "../config/db.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";
import cloudinary from "../config/cloudinary.js";

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

// update service
export const updateService = async (req, res) => {
  try {
    const id = req.params.id;
    const { title, slug, shortDes, longDes } = req.body;
    const existingService = await serviceCollection.findOne({ _id: new ObjectId(id) });

    if (!existingService) {
      return res.status(404).json({ message: "Service not found" });
    }
    const updatedService = {
      title,
      slug,
      shortDes,
      longDes,
      added: new Date(),
    };

    if (req.file) {
      if (existingService.icon?.public_id) {
        cloudinary.uploader.destroy(existingService.icon.public_id);
      }
      updatedService.icon = {
        url: req.file.path,
        public_id: req.file.filename,
      };
    } else {
      updatedService.icon = existingService.icon;
    }

    await serviceCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedService });
    res.status(200).json({ success: true, message: "Service updated successfully" });
  } catch (error) {
    console.error("Update service error:", error);
    res.status(500).json({ success: false, message: "Failed to update service" });
  }
};