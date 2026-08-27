import { Router } from "express";
import { getAllProjects } from "../controllers/projectController.js";

const projectRouter = Router();

projectRouter.get("/get", getAllProjects);

export default projectRouter;
