import { Router } from "express";
import { createProject, getAllProjects } from "../controllers/projectController.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
import { verifyId } from "../middleware/verifyId.js";
import { verifyPermission } from "../middleware/verifyPermission.js";

const projectRouter = Router();

projectRouter.get("/get", verifyPermission("projects"), getAllProjects);
projectRouter.post("/create", verifyId, verifyAdmin, createProject);

export default projectRouter;
