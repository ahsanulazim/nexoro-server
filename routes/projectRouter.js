import { Router } from "express";
import { getAllProjects } from "../controllers/projectController.js";
import { verifyPermission } from "../middleware/verifyPermission.js";

const projectRouter = Router();

projectRouter.get("/get", verifyPermission("projects"), getAllProjects);

export default projectRouter;
