import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import { isUnsafeFile } from "../utils/channelMediaAdapter.js";

// Storage configuration with auto resource_type detection
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const folderName = req.body.folder || "chat_attachments";
    const cleanOriginalName = (file.originalname || "attachment")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .substring(0, 100);
    const nameWithoutExt = cleanOriginalName.substring(0, cleanOriginalName.lastIndexOf(".")) || cleanOriginalName;

    // Detect format/extension
    let extension = file.mimetype?.split("/")[1] || "";
    if (extension === "svg+xml") extension = "svg";
    if (extension === "jpeg") extension = "jpg";

    return {
      folder: folderName,
      resource_type: "auto", // Crucial: allows video, audio, pdf, docx, etc.
      public_id: `${nameWithoutExt}-${Date.now()}`,
    };
  },
});

// File filter rejecting dangerous executables
const fileFilter = (req, file, cb) => {
  if (isUnsafeFile(file.originalname)) {
    return cb(
      new Error(`Security Alert: Uploading executable or script files is strictly prohibited.`),
      false
    );
  }
  cb(null, true);
};

// General upload (default 50MB ceiling; route-level validation applies fine-grained limits)
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter,
});

export default upload;
