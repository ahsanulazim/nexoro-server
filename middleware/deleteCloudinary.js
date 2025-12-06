import cloudinary from "../config/cloudinary.js";

export const deleteFromCloudinary = async (req, res, next) => {
  try {
    const { public_id } = req.body;

    if (!public_id) {
      return res.status(400).json({ error: "public_id is required" });
    }

    // Delete resource
    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result !== "ok") {
      return res.status(404).json({ error: "File not found or already deleted" });
    }

    // Attach result to request for next handler
    req.cloudinaryDeleteResult = result;
    next();
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    return res.status(500).json({ error: "Failed to delete from Cloudinary" });
  }
};
