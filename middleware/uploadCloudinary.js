import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

//storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const folderName = req.body.folder;
    let extension = file.mimetype.split("/")[1];

    if (extension === "svg+xml") {
      extension = "svg";
    }

    return {
      folder: folderName,
      format: extension,
      public_id: file.originalname.split(".")[0] + "-" + Date.now(),
    };
  },
});

//upload
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

export default upload;
