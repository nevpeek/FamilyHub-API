const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const db = require("./src/database/db");
const familyRoutes = require("./src/routes/familyRoutes");
const eventRoutes = require("./src/routes/eventRoutes");
const taskRoutes = require("./src/routes/taskRoutes");

dotenv.config();

const app = express();
const server = http.createServer(app);


const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use("/api/family", familyRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/tasks", taskRoutes);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.get("/api/health", (req, res) => {
  const databaseStatus = db
    .prepare("SELECT 1 AS ok")
    .get();

  res.json({
    success: true,
    app: "FamilyHub API",
    status: "online",
    version: "0.1.0",
    database: databaseStatus.ok === 1 ? "connected" : "error",
  });
});

io.on("connection", (socket) => {
  console.log(`FamilyHub client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`FamilyHub client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("====================================");
  console.log("        FamilyHub API v0.1.0");
  console.log("====================================");
  console.log(`API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log("====================================");
  console.log("");
});