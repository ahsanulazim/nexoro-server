import { Router } from "express";
import {
  createQuery,
  getAllQueries,
  getQueryById,
  updateQueryStatus,
  toggleStarQuery,
  addQueryNote,
  deleteQueryNote,
  deleteQuery,
  batchUpdateQueries,
} from "../controllers/queryController.js";
import { verifyPermission } from "../middleware/verifyPermission.js";

const queryRouter = Router();

// Public route: website visitors submit contact form
queryRouter.post("/", createQuery);

// Protected routes: require admin or member with "queries" permission
queryRouter.get("/", verifyPermission("queries"), getAllQueries);
queryRouter.post("/batch", verifyPermission("queries"), batchUpdateQueries);
queryRouter.get("/:id", verifyPermission("queries"), getQueryById);
queryRouter.patch("/:id/status", verifyPermission("queries"), updateQueryStatus);
queryRouter.patch("/:id/star", verifyPermission("queries"), toggleStarQuery);
queryRouter.post("/:id/notes", verifyPermission("queries"), addQueryNote);
queryRouter.delete("/:id/notes/:noteId", verifyPermission("queries"), deleteQueryNote);
queryRouter.delete("/:id", verifyPermission("queries"), deleteQuery);

export default queryRouter;
