import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userRouter from "./routes/userRouter.js";
import clientRouter from "./routes/clientRouter.js";
import msgRouter from "./routes/msgRouter.js";
import serviceRouter from "./routes/serviceRouter.js";
import teamRouter from "./routes/teamRouter.js";
import reviewRouter from "./routes/reviewRouter.js";
import sliderRouter from "./routes/sliderRouter.js";
import planRouter from "./routes/planRouter.js";
import blogRouter from "./routes/blogRouter.js";
import categoryRouter from "./routes/categoryRouter.js";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://nexoro-tau.vercel.app",
      "https://nexorosolution.com",
    ],
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/users", userRouter);
app.use("/clients", clientRouter);
app.use("/messages", msgRouter);
app.use("/services", serviceRouter);
app.use("/team", teamRouter);
app.use("/reviews", reviewRouter);
app.use("/sliders", sliderRouter);
app.use("/plans", planRouter);
app.use("/blogs", blogRouter);
app.use("/category", categoryRouter);

app.get("/", (req, res) => res.send("Hello World!"));

app.listen(port, () => console.log(`Server running on port ${port}`));
