import express from "express";
import http from "http";
import cors from "cors";
import { randomUUID } from "crypto";
import { Server } from "socket.io";

const PORT = process.env.PORT || 5000;
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    }
  })
);

app.get("/", (_req, res) => {
  res.json({ app: "MeetConnect", status: "signaling server running" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

function createParticipant(socket, name, role) {
  return {
    id: socket.id,
    name,
    role,
    micOn: true,
    cameraOn: true,
    canShareScreen: role !== "user",
    raisedHand: false
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      locked: false,
      password: "",
      chatEnabled: true,
      participantScreenShareEnabled: true,
      activeShareSocketId: null,
      participants: new Map(),
      pendingRequests: new Map()
    });
  }
  return rooms.get(roomId);
}

function serializeParticipant(participant) {
  return {
    id: participant.id,
    name: participant.name,
    role: participant.role,
    micOn: participant.micOn,
    cameraOn: participant.cameraOn,
    canShareScreen: participant.canShareScreen,
    raisedHand: participant.raisedHand
  };
}

function serializeParticipants(room) {
  return [...room.participants.values()].map(serializeParticipant);
}

function serializePending(room) {
  return [...room.pendingRequests.values()];
}

function broadcastParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomId).emit("participants-updated", {
    participants: serializeParticipants(room),
    locked: room.locked,
    pendingRequests: serializePending(room),
    chatEnabled: room.chatEnabled,
    participantScreenShareEnabled: room.participantScreenShareEnabled
  });
}

function emitSystemMessage(roomId, message) {
  io.to(roomId).emit("system-message", {
    id: randomUUID(),
    message,
    timestamp: new Date().toISOString()
  });
}

function getActor(socket) {
  const roomId = socket.data.roomId;
  const room = rooms.get(roomId);
  const participant = room?.participants.get(socket.id);
  return { roomId, room, participant };
}

function canManage(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === "organizer") return target.id !== actor.id;
  if (actor.role === "admin") return target.role === "user";
  return false;
}

function notifyManagers(roomId, room) {
  const payload = serializePending(room);
  room.participants.forEach((participant) => {
    if (participant.role === "organizer" || participant.role === "admin") {
      io.to(participant.id).emit("pending-requests", payload);
    }
  });
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, name, password }) => {
    if (!roomId || !name) return;

    const room = getRoom(roomId);
    const cleanName = String(name).trim().slice(0, 60);
    const cleanPassword = String(password || "").trim().slice(0, 80);
    if (!cleanName) return;

    if (room.participants.size === 0 && cleanPassword) {
      room.password = cleanPassword;
    }

    if (room.password && room.password !== cleanPassword) {
      socket.emit("join-error", {
        message: "Incorrect meeting password."
      });
      return;
    }

    if (room.locked && room.participants.size > 0) {
      const request = {
        id: randomUUID(),
        socketId: socket.id,
        name: cleanName,
        password: cleanPassword,
        requestedAt: new Date().toISOString()
      };
      socket.data.pendingRoomId = roomId;
      socket.data.pendingName = cleanName;
      room.pendingRequests.set(socket.id, request);
      socket.emit("waiting-room", { roomId });
      notifyManagers(roomId, room);
      return;
    }

    joinUnlockedRoom(socket, roomId, cleanName);
  });

  socket.on("offer", ({ target, offer, name }) => {
    io.to(target).emit("offer", {
      from: socket.id,
      offer,
      name: name || socket.data.name
    });
  });

  socket.on("answer", ({ target, answer }) => {
    io.to(target).emit("answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("chat-message", ({ roomId, message, name, timestamp, clientMessageId }) => {
    if (!roomId || !message) return;
    const room = rooms.get(roomId);
    const participant = room?.participants.get(socket.id);
    if (!participant) return;
    if (!room.chatEnabled && !["organizer", "admin"].includes(participant.role)) {
      socket.emit("chat-disabled", { message: "Chat is disabled by the organizer." });
      return;
    }

    const messageData = {
      id: randomUUID(),
      clientMessageId,
      socketId: socket.id,
      name: name || socket.data.name || "Guest",
      message: String(message).slice(0, 1000),
      timestamp: timestamp || new Date().toISOString()
    };

    io.to(roomId).emit("chat-message", messageData);
  });

  socket.on("participant-status", ({ micOn, cameraOn }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || !participant) return;

    if (typeof micOn === "boolean") participant.micOn = micOn;
    if (typeof cameraOn === "boolean") participant.cameraOn = cameraOn;
    broadcastParticipants(roomId);
  });

  socket.on("set-lock", ({ locked }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    room.locked = Boolean(locked);
    emitSystemMessage(roomId, room.locked ? "Meeting locked." : "Meeting unlocked.");
    broadcastParticipants(roomId);
  });

  socket.on("set-chat-enabled", ({ enabled }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    room.chatEnabled = Boolean(enabled);
    emitSystemMessage(roomId, room.chatEnabled ? "Chat enabled." : "Chat disabled.");
    broadcastParticipants(roomId);
  });

  socket.on("set-room-screen-share-enabled", ({ enabled }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    room.participantScreenShareEnabled = Boolean(enabled);
    emitSystemMessage(
      roomId,
      room.participantScreenShareEnabled
        ? "Participant screen sharing enabled."
        : "Participant screen sharing disabled."
    );
    broadcastParticipants(roomId);
  });

  socket.on("allow-user", ({ socketId }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    const request = room.pendingRequests.get(socketId);
    if (!request) return;
    room.pendingRequests.delete(socketId);
    const waitingSocket = io.sockets.sockets.get(socketId);
    if (waitingSocket) {
      waitingSocket.emit("join-approved", { roomId, name: request.name });
      joinUnlockedRoom(waitingSocket, roomId, request.name);
    }
    notifyManagers(roomId, room);
  });

  socket.on("deny-user", ({ socketId }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    room.pendingRequests.delete(socketId);
    io.to(socketId).emit("join-denied", { reason: "The meeting host denied your request." });
    notifyManagers(roomId, room);
  });

  socket.on("make-admin", ({ target }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    const targetParticipant = room.participants.get(target);
    if (!targetParticipant || targetParticipant.role === "organizer") return;
    targetParticipant.role = "admin";
    targetParticipant.canShareScreen = true;
    io.to(target).emit("role-updated", { role: "admin", canShareScreen: true });
    broadcastParticipants(roomId);
  });

  socket.on("remove-admin", ({ target }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    const targetParticipant = room.participants.get(target);
    if (!targetParticipant || targetParticipant.role !== "admin") return;
    targetParticipant.role = "user";
    targetParticipant.canShareScreen = false;
    io.to(target).emit("role-updated", { role: "user", canShareScreen: false });
    broadcastParticipants(roomId);
  });

  socket.on("set-screen-share-permission", ({ target, canShareScreen }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    const targetParticipant = room.participants.get(target);
    if (!targetParticipant || targetParticipant.role !== "user") return;
    targetParticipant.canShareScreen = Boolean(canShareScreen);
    io.to(target).emit("screen-share-permission", {
      canShareScreen: targetParticipant.canShareScreen
    });
    broadcastParticipants(roomId);
  });

  socket.on("mute-participant", ({ target }) => {
    const { roomId, room, participant } = getActor(socket);
    const targetParticipant = room?.participants.get(target);
    if (!roomId || !room || !canManage(participant, targetParticipant)) return;

    targetParticipant.micOn = false;
    io.to(target).emit("force-mute");
    broadcastParticipants(roomId);
  });

  socket.on("mute-all", () => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    room.participants.forEach((targetParticipant) => {
      if (targetParticipant.id === socket.id) return;
      targetParticipant.micOn = false;
      io.to(targetParticipant.id).emit("force-mute");
    });
    emitSystemMessage(roomId, "Organizer muted all participants.");
    broadcastParticipants(roomId);
  });

  socket.on("remove-participant", ({ target }) => {
    const { roomId, room, participant } = getActor(socket);
    const targetParticipant = room?.participants.get(target);
    if (!roomId || !room || !canManage(participant, targetParticipant)) return;

    io.to(target).emit("removed-from-room", { reason: "You were removed from the meeting." });
    const targetSocket = io.sockets.sockets.get(target);
    targetSocket?.disconnect(true);
  });

  socket.on("reaction", ({ reaction }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || !participant) return;
    const allowed = ["👍", "❤️", "😂", "👏", "🎉", "🔥"];
    if (!allowed.includes(reaction)) return;

    io.to(roomId).emit("reaction", {
      id: randomUUID(),
      socketId: socket.id,
      name: participant.name,
      reaction,
      timestamp: new Date().toISOString()
    });
  });

  socket.on("raise-hand", ({ raised }) => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || !participant) return;

    participant.raisedHand = Boolean(raised);
    emitSystemMessage(roomId, `${participant.name} ${participant.raisedHand ? "raised" : "lowered"} their hand.`);
    broadcastParticipants(roomId);
  });

  socket.on("screen-share-started", () => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || !participant) return;
    if (participant.role === "user" && !room.participantScreenShareEnabled) {
      socket.emit("screen-share-denied", { message: "Participant screen sharing is disabled." });
      return;
    }

    if (room.activeShareSocketId && room.activeShareSocketId !== socket.id) {
      io.to(room.activeShareSocketId).emit("force-stop-screen-share");
    }
    room.activeShareSocketId = socket.id;
    emitSystemMessage(roomId, `${participant.name} started screen sharing.`);
  });

  socket.on("screen-share-stopped", () => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || !participant) return;

    if (room.activeShareSocketId === socket.id) {
      room.activeShareSocketId = null;
      emitSystemMessage(roomId, `${participant.name} stopped screen sharing.`);
    }
  });

  socket.on("end-meeting", () => {
    const { roomId, room, participant } = getActor(socket);
    if (!roomId || !room || participant?.role !== "organizer") return;

    io.to(roomId).emit("meeting-ended", {
      reason: "The organizer ended the meeting."
    });

    const participantIds = [...room.participants.keys()];
    const pendingRequests = [...room.pendingRequests.values()];
    rooms.delete(roomId);

    participantIds.forEach((participantId) => {
      const participantSocket = io.sockets.sockets.get(participantId);
      participantSocket?.leave(roomId);
      participantSocket?.disconnect(true);
    });

    pendingRequests.forEach((request) => {
      io.to(request.socketId).emit("join-denied", {
        reason: "The meeting has ended."
      });
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const pendingRoomId = socket.data.pendingRoomId;

    if (pendingRoomId) {
      const pendingRoom = rooms.get(pendingRoomId);
      pendingRoom?.pendingRequests.delete(socket.id);
      if (pendingRoom) notifyManagers(pendingRoomId, pendingRoom);
    }

    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    room.participants.delete(socket.id);
    socket.to(roomId).emit("user-disconnected", socket.id);
    if (participant) {
      emitSystemMessage(roomId, `${participant.name} left.`);
    }
    if (room.activeShareSocketId === socket.id) {
      room.activeShareSocketId = null;
      emitSystemMessage(roomId, "Screen sharing stopped.");
    }

    if (participant?.role === "organizer" && room.participants.size > 0) {
      const nextOrganizer = room.participants.values().next().value;
      nextOrganizer.role = "organizer";
      nextOrganizer.canShareScreen = true;
      io.to(nextOrganizer.id).emit("role-updated", {
        role: "organizer",
        canShareScreen: true
      });
    }

    if (room.participants.size === 0 && room.pendingRequests.size === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcastParticipants(roomId);
  });
});

function joinUnlockedRoom(socket, roomId, name) {
  const room = getRoom(roomId);
  const role = room.participants.size === 0 ? "organizer" : "user";
  const participant = createParticipant(socket, name, role);

  socket.data.roomId = roomId;
  socket.data.name = name;
  socket.data.pendingRoomId = null;
  socket.data.pendingName = null;
  room.pendingRequests.delete(socket.id);
  room.participants.set(socket.id, participant);
  socket.join(roomId);

  socket.emit("joined-room", {
    socketId: socket.id,
    role,
    locked: room.locked,
    canShareScreen: participant.canShareScreen,
    chatEnabled: room.chatEnabled,
    participantScreenShareEnabled: room.participantScreenShareEnabled,
    participants: serializeParticipants(room),
    pendingRequests: serializePending(room)
  });

  socket.to(roomId).emit("user-connected", {
    socketId: socket.id,
    name,
    role
  });

  emitSystemMessage(roomId, `${name} joined.`);
  broadcastParticipants(roomId);
}

server.listen(PORT, () => {
  console.log(`MeetConnect signaling server listening on http://localhost:${PORT}`);
});
