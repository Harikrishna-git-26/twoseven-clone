const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const peers = new Map();

io.on("connection", socket => {
  console.log("New connection:", socket.id);
  peers.set(socket.id, { camOn: false, micOn: false, name: "" });

  socket.emit("connect-success", { id: socket.id });

  socket.on("set-name", ({ name }) => {
    if (peers.has(socket.id)) peers.get(socket.id).name = name;
    io.emit("peer-updated", { id: socket.id, name });
  });

  socket.on("update-status", status => {
    if (peers.has(socket.id)) Object.assign(peers.get(socket.id), status);
    io.emit("peer-updated", { id: socket.id, ...status });
  });

  socket.on("offer", data => {
    io.to(data.to).emit("offer", { from: socket.id, signal: data.signal });
  });

  socket.on("answer", data => {
    io.to(data.to).emit("answer", { from: socket.id, signal: data.signal });
  });

  socket.on("send-message", data => {
    io.to(data.to).emit("receive-message", { from: socket.id, fromName: data.name, msg: data.msg });
  });

  socket.on("send-video", data => {
    io.to(data.to).emit("receive-video", { url: data.url, action: data.action, time: data.time });
  });

  socket.on("disconnect", () => {
    peers.delete(socket.id);
    io.emit("peer-left", { id: socket.id });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
