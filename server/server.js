const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

let server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- Room/Group logic ---
const peers = new Map();
const groupPeers = new Map();

// --- Generate 5-character unique ID ---
function generateShortId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id;
  do {
    id = "";
    for (let i = 0; i < 5; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (peers.has(id));
  return id;
}

// Build peer list for the group
function buildPeerList(shortId) {
  const group = groupPeers.get(shortId) || new Set([shortId]);
  return Array.from(group)
    .map(id => {
      const peer = peers.get(id);
      if (!peer) return null;
      return {
        id: peer.shortId,
        name: peer.name,
        camOn: peer.camOn,
        micOn: peer.micOn,
        streamId: peer.streamId ?? null,
      };
    })
    .filter(Boolean);
}

// --- Socket.IO ---
io.on("connection", socket => {
  const shortId = generateShortId();
  peers.set(shortId, { socketId: socket.id, shortId, name: "", camOn: false, micOn: false, streamId: null });
  groupPeers.set(shortId, new Set([shortId]));

  socket.emit("connect-success", { id: shortId });
  socket.emit("update-peers", buildPeerList(shortId));

  // Set Name
  socket.on("set-name", ({ name }) => {
    const info = peers.get(shortId);
    if (info) {
      info.name = name;
      peers.set(shortId, info);
      io.to(socket.id).emit("peer-updated", { id: shortId, name, camOn: info.camOn, micOn: info.micOn });
      io.to(socket.id).emit("update-peers", buildPeerList(shortId));
    }
  });

  // Update Cam/Mic
  socket.on("update-status", status => {
    const info = peers.get(shortId);
    if (info) {
      info.camOn = !!status.camOn;
      info.micOn = !!status.micOn;
      peers.set(shortId, info);
      for (const peerId of groupPeers.get(shortId) || []) {
        const targetPeer = peers.get(peerId);
        if (targetPeer)
          io.to(targetPeer.socketId).emit("peer-updated", { id: shortId, name: info.name, camOn: info.camOn, micOn: info.micOn });
      }
    }
  });

  // Connect to another peer
  socket.on("connect-peer", targetId => {
    if (!targetId || !peers.has(targetId) || targetId === shortId) return;
    groupPeers.get(shortId).add(targetId);
    groupPeers.get(targetId).add(shortId);
    [shortId, targetId].forEach(id => {
      const p = peers.get(id);
      if (p) io.to(p.socketId).emit("update-peers", buildPeerList(id));
    });
  });

  // WebRTC Signaling
  socket.on("offer", ({ to, signal }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("offer", { from: shortId, signal });
    }
  });

  socket.on("answer", ({ to, signal }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("answer", { from: shortId, signal });
    }
  });

  // Chat
  socket.on("send-message", ({ to, msg, name }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("receive-message", { from: shortId, fromName: name, msg });
    }
  });

  // Video sharing
  socket.on("send-video", ({ to, url, action, time }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("receive-video", { url, action, time });
    }
  });

  // Remove peer
  socket.on("remove-peer", ({ id }) => {
    if (groupPeers.get(shortId)?.has(id)) {
      groupPeers.get(shortId).delete(id);
      groupPeers.get(id).delete(shortId);
      [shortId, id].forEach(pid => {
        const peer = peers.get(pid);
        if (peer) io.to(peer.socketId).emit("update-peers", buildPeerList(pid));
      });
      const targetSocket = peers.get(id)?.socketId;
      if (targetSocket) {
        io.to(targetSocket).emit("remove-peer", { id });
        setTimeout(() => { if (io.sockets.sockets.get(targetSocket)) io.sockets.sockets.get(targetSocket).disconnect(true); }, 200);
      }
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    peers.delete(shortId);
    for (const groupSet of groupPeers.values()) groupSet.delete(shortId);
    groupPeers.delete(shortId);
  });

  socket.on("leave", () => socket.disconnect());
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
