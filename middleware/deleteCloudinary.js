import cloudinary from "../config/cloudinary.js";

export const deleteFromCloudinary = async (req, res, next) => {
  try {
    const { public_id } = req.body || {};

    if (!public_id) {
      return next();
    }

    // Delete resource from Cloudinary
    const result = await cloudinary.uploader.destroy(public_id);
    req.cloudinaryDeleteResult = result;
    next();
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    // Continue so database record can still be deleted even if Cloudinary fails
    next();
  }
};
