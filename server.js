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
import portfolioRouter from "./routes/portfolioRouter.js";
import categoryRouter from "./routes/categoryRouter.js";
import subServiceRouter from "./routes/subServiceRouter.js";
import cartRouter from "./routes/cartRouter.js";
import orderRouter from "./routes/orderRouter.js";
import paymentRouter from "./routes/paymentRouter.js";
import dashboardRouter from "./routes/dashboardRouter.js";
import chartRouter from "./routes/chartRouter.js";
import { app, server } from "./socket/socket.js";
import messageRouter from "./routes/messageRouter.js";
import facebookRouter from "./routes/facebookRouter.js";

dotenv.config();

const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:3000", "https://nexorosolution.com"],
    credentials: true,
  }),
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
app.use("/portfolio", portfolioRouter);
app.use("/category", categoryRouter);
app.use("/subServices", subServiceRouter);
app.use("/cart", cartRouter);
app.use("/orders", orderRouter);
app.use("/payment", paymentRouter);
app.use("/dashboard", dashboardRouter);
app.use("/analytics", chartRouter);
app.use("/conversations", messageRouter);
app.use("/facebook", facebookRouter);

app.get("/", (req, res) => res.send("Hello World!"));

server.listen(port, () => console.log(`Server running on port ${port}`));
