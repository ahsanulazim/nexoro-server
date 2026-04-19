import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const serviceCollection = client.db("nexoro").collection("Services");
await serviceCollection.createIndex({ slug: 1 }, { unique: true });

//create new service
export const createService = async (req, res) => {
  const { title, shortDes, longDes } = req.body;
  const slug = title
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-");
  const added = new Date();
  try {
    const serviceData = {
      title,
      slug,
      shortDes,
      longDes,
      added,
    };

    // Handle SVG icon file
    if (req.files?.icon) {
      serviceData.icon = req.files.icon[0].path;
      serviceData.icon_public_id = req.files.icon[0].filename;
    }

    // Handle cover image file
    if (req.files?.coverImage) {
      serviceData.coverImage = req.files.coverImage[0].path;
      serviceData.cover_image_public_id = req.files.coverImage[0].filename;
    }

    await serviceCollection.insertOne(serviceData);
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

// Get a Service
export const getService = async (req, res) => {
  const slug = req.params.slug;
  try {
    const service = await serviceCollection.findOne({ slug });
    if (service) {
      return res.status(200).json(service);
    } else {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Delete services
export const deleteServices = async (req, res) => {
  const slug = req.params.slug;
  try {
    // Find the service to get public IDs
    const service = await serviceCollection.findOne({ slug });

    if (!service) {
      return res.send({
        success: false,
        message: "Service not found in MongoDB",
      });
    }

    // Delete SVG icon from Cloudinary
    if (service.icon_public_id) {
      await cloudinary.uploader.destroy(service.icon_public_id);
    }

    // Delete cover image from Cloudinary
    if (service.cover_image_public_id) {
      await cloudinary.uploader.destroy(service.cover_image_public_id);
    }

    // Delete service from MongoDB
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
    const existingService = await serviceCollection.findOne({
      _id: new ObjectId(id),
    });

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

    // Handle SVG icon file
    if (req.files?.svgIcon) {
      if (existingService.svg_icon_public_id) {
        await cloudinary.uploader.destroy(existingService.icon_public_id);
      }
      updatedService.icon = req.files.icon[0].path;
      updatedService.icon_public_id = req.files.icon[0].filename;
    } else {
      updatedService.icon = existingService.svgIcon;
      updatedService.icon_public_id = existingService.icon_public_id;
    }

    // Handle cover image file
    if (req.files?.coverImage) {
      if (existingService.cover_image_public_id) {
        await cloudinary.uploader.destroy(
          existingService.cover_image_public_id,
        );
      }
      updatedService.coverImage = req.files.coverImage[0].path;
      updatedService.cover_image_public_id = req.files.coverImage[0].filename;
    } else {
      updatedService.coverImage = existingService.coverImage;
      updatedService.cover_image_public_id =
        existingService.cover_image_public_id;
    }

    await serviceCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedService },
    );
    res
      .status(200)
      .json({ success: true, message: "Service updated successfully" });
  } catch (error) {
    console.error("Update service error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update service" });
  }
};
