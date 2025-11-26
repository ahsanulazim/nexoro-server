import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userRouter from "./routes/userRouter.js";
import clientRouter from "./routes/clientRouter.js";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:3000", "https://nexoro-tau.vercel.app"],
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/users", userRouter);
app.use("/clients", clientRouter);

app.get("/", (req, res) => res.send("Hello World!"));

app.listen(port, () => console.log(`Server running on port ${port}`));
