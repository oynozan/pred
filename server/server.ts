require("dotenv").config();

import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import express, { type Application } from "express";

import publicRoutes from "./routes/public";
import protectedRoutes from "./routes/protected";

import { socketServer } from "./socket";
import { SocketListeners } from "./socket/listeners";
import { userToken, verifyServerToken } from "./routes/middleware";

const app: Application = express();
const server = require("http").createServer(app);

app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CLIENT!, credentials: true }));
app.use(helmet());
app.use(
    rateLimit({
        windowMs: 2 * 60 * 1000,
        max: 500,
        message: "Too many requests, please try again later.",
        standardHeaders: true,
        legacyHeaders: false,
    }),
);
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/", userToken, publicRoutes);
app.use("/protected", verifyServerToken, protectedRoutes);

// Socket.io
const io = socketServer(server);
new SocketListeners(io);
(app as any).set("io", io); // Expose io for routes broadcast usage

// Start the server
async function start() {
    try {
        if (!process.env.MONGO_URI) throw new Error("Missing MONGO_URI env var");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("MongoDB connection error", err);
        process.exit(1);
    }

    server.listen(process.env.SERVER_PORT, () =>
        console.log(`Server is running on port ${process.env.SERVER_PORT}`),
    );
}

start();
