import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { sendIncomingCallPush } from "./push";

type SignalMessage = {
  type: "join" | "call" | "offer" | "answer" | "ice" | "leave" | "ping";
  room?: string;
  peerId?: string;
  pushToken?: string;
  payload?: unknown;
};

const rooms = new Map<string, Map<string, WebSocket>>();
const roomPushTokens = new Map<string, Set<string>>();

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function leaveRoom(socket: WebSocket, room?: string, peerId?: string) {
  if (!room || !peerId) return;
  const peers = rooms.get(room);
  if (!peers) return;
  peers.delete(peerId);
  const token = (socket as WebSocket & { waselPushToken?: string }).waselPushToken;
  const tokens = roomPushTokens.get(room);
  if (token && tokens) {
    tokens.delete(token);
    if (tokens.size === 0) roomPushTokens.delete(room);
  }
  for (const [otherPeerId, otherSocket] of peers) {
    send(otherSocket, { type: "peer-left", peerId });
    if (otherSocket.readyState !== WebSocket.OPEN) peers.delete(otherPeerId);
  }
  if (peers.size === 0) rooms.delete(room);
}

function attachSignaling(server: ReturnType<typeof createServer>) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    let room: string | undefined;
    let peerId: string | undefined;
    let pushToken: string | undefined;

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as SignalMessage;
        if (message.type === "ping") {
          send(socket, { type: "pong", timestamp: Date.now() });
          return;
        }

        if (message.type === "join") {
          const requestedRoom = String(message.room ?? "").trim().toUpperCase();
          const requestedPeer = String(message.peerId ?? "").trim();
          if (!/^[A-Z0-9-]{4,32}$/.test(requestedRoom) || !requestedPeer) {
            send(socket, { type: "error", message: "بيانات غرفة الاتصال غير صحيحة" });
            return;
          }
          if (room && peerId) {
            leaveRoom(socket, room, peerId);
            room = undefined;
            peerId = undefined;
          }
          const peers = rooms.get(requestedRoom) ?? new Map<string, WebSocket>();
          if (peers.has(requestedPeer)) {
            send(socket, { type: "error", message: "معرّف الاتصال مستخدم بالفعل" });
            return;
          }
          if (peers.size >= 2) {
            send(socket, { type: "error", message: "الغرفة ممتلئة؛ يسمح واصل بطرفين فقط" });
            return;
          }
          room = requestedRoom;
          peerId = requestedPeer;
          pushToken = typeof message.pushToken === "string" ? message.pushToken : undefined;
          const existingPeers = [...peers.keys()];
          const registeredTokens = roomPushTokens.get(room) ?? new Set<string>();
          peers.set(peerId, socket);
          rooms.set(room, peers);
          send(socket, { type: "joined", room, peerId, peers: existingPeers });
          for (const [otherPeerId, otherSocket] of peers) {
            if (otherPeerId !== peerId) send(otherSocket, { type: "peer-joined", peerId });
          }
          for (const token of registeredTokens) {
            if (token !== pushToken) void sendIncomingCallPush(token, room);
          }
          (socket as WebSocket & { waselPushToken?: string }).waselPushToken = pushToken;
          if (pushToken) registeredTokens.add(pushToken);
          roomPushTokens.set(room, registeredTokens);
          return;
        }

        if (message.type === "leave") {
          leaveRoom(socket, room, peerId);
          room = undefined;
          peerId = undefined;
          return;
        }

        if (!room || !peerId) {
          send(socket, { type: "error", message: "انضم إلى الغرفة أولًا" });
          return;
        }

        const peers = rooms.get(room);
        if (!peers) return;
        for (const [otherPeerId, otherSocket] of peers) {
          if (otherPeerId !== peerId) {
            send(otherSocket, { type: message.type, peerId, payload: message.payload });
          }
        }
      } catch {
        send(socket, { type: "error", message: "رسالة signaling غير صالحة" });
      }
    });

    socket.on("close", () => leaveRoom(socket, room, peerId));
    socket.on("error", () => leaveRoom(socket, room, peerId));
  });

  console.log("[voice] WebSocket signaling enabled at /ws");
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "8081";
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isLocalDevelopmentOrigin(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      if (origin && !isLocalDevelopmentOrigin(origin)) { res.sendStatus(403); return; }
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/push/register", (req, res) => {
    const room = String(req.body?.room ?? "").trim().toUpperCase();
    const token = String(req.body?.token ?? "").trim();
    if (!/^[A-Z0-9-]{4,32}$/.test(room) || !token.startsWith("ExponentPushToken[")) {
      res.status(400).json({ ok: false, message: "بيانات Push غير صحيحة" });
      return;
    }
    const tokens = roomPushTokens.get(room) ?? new Set<string>();
    tokens.add(token);
    roomPushTokens.set(room, tokens);
    res.json({ ok: true });
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true, voiceSignaling: true, timestamp: Date.now() }));
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  const webRoot = path.join(process.cwd(), "web-dist");
  app.use(express.static(webRoot, { index: false }));
  app.get(/^(?!\/api(?:\/|$)|\/ws(?:\/|$)).*/, (req, res) => {
    if (path.extname(req.path) || req.path.startsWith("/_expo/") || req.path === "/favicon.ico") {
      res.sendStatus(404);
      return;
    }
    res.sendFile(path.join(webRoot, "index.html"));
  });

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  attachSignaling(server);
  server.listen(port, "0.0.0.0", () => console.log(`[api] server listening on port ${port}`));
}

startServer().catch(console.error);
