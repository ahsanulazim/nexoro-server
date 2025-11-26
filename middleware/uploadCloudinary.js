import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

//storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "clients",
    format: async (req, file) => {
      const extention = file.mimetype.split("/")[1];
      return extention; // dynamic format
    },
    // supports promises as well
    public_id: (req, file) =>
      file.originalname.split(".")[0] + "-" + Date.now(),
  },
});

//upload
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

export default upload;
