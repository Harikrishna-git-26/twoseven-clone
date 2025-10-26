const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

// --- Peer management ---
const peers = new Map();       // shortId -> peer info
const groupPeers = new Map();  // shortId -> set of connected peers

function generateShortId() {
  return Math.random().toString(36).substring(2,7).toUpperCase();
}

function buildPeerList(shortId) {
  const group = groupPeers.get(shortId) || new Set([shortId]);
  return Array.from(group).map(id => {
    const p = peers.get(id);
    if (!p) return null;
    return { id: p.shortId, name: p.name, camOn: p.camOn, micOn: p.micOn };
  }).filter(Boolean);
}

io.on("connection", socket => {
  const shortId = generateShortId();
  peers.set(shortId, { socketId: socket.id, shortId, name:"", camOn:false, micOn:false });
  groupPeers.set(shortId, new Set([shortId]));

  socket.emit("connect-success", { id: shortId });
  socket.emit("update-peers", buildPeerList(shortId));

  // Name update
  socket.on("set-name", ({ name }) => {
    const info = peers.get(shortId);
    if (info) {
      info.name = name;
      peers.set(shortId, info);
      io.to(socket.id).emit("peer-updated", info);
      io.to(socket.id).emit("update-peers", buildPeerList(shortId));
    }
  });

  // Cam/mic
  socket.on("update-status", (status) => {
    const info = peers.get(shortId);
    if (info) {
      info.camOn = !!status.camOn;
      info.micOn = !!status.micOn;
      peers.set(shortId, info);
      for (const pid of groupPeers.get(shortId)) {
        const p = peers.get(pid);
        if (p) io.to(p.socketId).emit("peer-updated", { id: shortId, ...info });
      }
    }
  });

  // Connect to another peer
  socket.on("connect-peer", (targetId) => {
    if (!targetId || !peers.has(targetId) || targetId===shortId) return;
    groupPeers.get(shortId).add(targetId);
    groupPeers.get(targetId).add(shortId);
    [shortId,targetId].forEach(id => {
      const p = peers.get(id);
      if(p) io.to(p.socketId).emit("update-peers", buildPeerList(id));
    });
  });

  // WebRTC signaling
  socket.on("offer", ({ to, signal, name }) => {
    const target = peers.get(to);
    if(target) io.to(target.socketId).emit("offer", { from: shortId, signal, name });
  });
  socket.on("answer", ({ to, signal }) => {
    const target = peers.get(to);
    if(target) io.to(target.socketId).emit("answer", { from: shortId, signal });
  });

  // Chat
  socket.on("send-message", ({ to, msg, name }) => {
    const target = peers.get(to);
    if(target) io.to(target.socketId).emit("receive-message", { from: shortId, fromName: name ?? "", msg });
  });

  // Video sync
  socket.on("send-video", ({ to, url, action, time }) => {
    const target = peers.get(to);
    if(target) io.to(target.socketId).emit("receive-video", { url, action, time });
  });

  // Remove peer
  socket.on("remove-peer", ({ id }) => {
    if(groupPeers.get(shortId)?.has(id)) {
      groupPeers.get(shortId).delete(id);
      groupPeers.get(id)?.delete(shortId);
      [shortId,id].forEach(pid => {
        const p = peers.get(pid);
        if(p) io.to(p.socketId).emit("update-peers", buildPeerList(pid));
      });
      const targetSocket = peers.get(id)?.socketId;
      if(targetSocket) io.to(targetSocket).emit("remove-peer",{id});
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    peers.delete(shortId);
    for(const g of groupPeers.values()) g.delete(shortId);
    groupPeers.delete(shortId);
  });

  socket.on("leave", () => socket.disconnect());
});

server.listen(PORT, ()=>console.log(`Server running on ${PORT}`));
