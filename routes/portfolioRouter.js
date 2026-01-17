import express from "express";
import {
  createPortfolio,
  deleteAPortfolio,
  getAllPortfolios,
  getPortfolio,
  updatePortfolio,
} from "../controllers/portfolioController.js";
import upload from "../middleware/uploadCloudinary.js";
import { deleteFromCloudinary } from "../middleware/deleteCloudinary.js";

const router = express.Router();

router.post("/", upload.single("image"), createPortfolio);
router.post("/portfolioImages", upload.array("images"));
router.get("/allPortfolios", getAllPortfolios);
router.get("/:slug", getPortfolio);
router.delete("/:id", deleteFromCloudinary, deleteAPortfolio);
router.put("/:id", upload.single("image"), updatePortfolio);

export default router;
