import "dotenv/config"; // automatically loads .env
// import dotenv from "dotenv";
import http from "http";
import mongoose from "mongoose";
import app from "./app.js";
import { startSettlementJob } from "./jobs/settlementJob.js";
import { initializeSocket } from "./utils/socket.js";

// Initialize scheduled jobs
startSettlementJob();

const DB = process.env.DATABASE.replace(
  "<password>",
  process.env.DATABASE_PASSWORD,
);

mongoose
  .connect(DB)
  .then(() => {
    console.log("✅ Database connection established successfully!");
  })
  .catch((err) => console.log("❌ Database connection failed:", err));

const port = process.env.PORT;

const server = http.createServer(app);
const io = initializeSocket(server);

app.set("io", io);

server.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
