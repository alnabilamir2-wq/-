import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import WebSocket from "ws";

const PORT = 30000 + (process.pid % 1000);
let server: ChildProcess;

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      cleanup();
      resolve(JSON.parse(raw.toString()));
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

describe("voice signaling", () => {
  beforeAll(async () => {
    server = spawn("pnpm", ["exec", "tsx", "server/_core/index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let startupError = "";
    server.stderr?.on("data", (chunk) => { startupError += chunk.toString(); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (response.ok) return;
      } catch { /* server is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`signaling server did not start${startupError ? `: ${startupError}` : ""}`);
  }, 10000);

  afterAll(() => server?.kill("SIGTERM"));

  it("relays join and offer/answer messages between two peers", async () => {
    const alice = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const bob = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await Promise.all([waitForOpen(alice), waitForOpen(bob)]);

    alice.send(JSON.stringify({ type: "join", room: "TEST-ROOM", peerId: "alice" }));
    expect(await nextMessage(alice)).toMatchObject({ type: "joined", room: "TEST-ROOM" });

    bob.send(JSON.stringify({ type: "join", room: "TEST-ROOM", peerId: "bob" }));
    expect(await nextMessage(bob)).toMatchObject({ type: "joined", peers: ["alice"] });
    expect(await nextMessage(alice)).toMatchObject({ type: "peer-joined", peerId: "bob" });

    alice.send(JSON.stringify({ type: "offer", payload: { sdp: "offer" } }));
    expect(await nextMessage(bob)).toMatchObject({ type: "offer", peerId: "alice", payload: { sdp: "offer" } });

    bob.send(JSON.stringify({ type: "answer", payload: { sdp: "answer" } }));
    expect(await nextMessage(alice)).toMatchObject({ type: "answer", peerId: "bob", payload: { sdp: "answer" } });

    alice.close();
    bob.close();
  }, 15000);

  it("rejects a duplicate peer ID without removing the existing peer", async () => {
    const alice = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const duplicate = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await Promise.all([waitForOpen(alice), waitForOpen(duplicate)]);

    alice.send(JSON.stringify({ type: "join", room: "DUPLICATE", peerId: "alice" }));
    expect(await nextMessage(alice)).toMatchObject({ type: "joined", room: "DUPLICATE" });
    duplicate.send(JSON.stringify({ type: "join", room: "DUPLICATE", peerId: "alice" }));
    expect(await nextMessage(duplicate)).toMatchObject({ type: "error", message: "معرّف الاتصال مستخدم بالفعل" });

    const bob = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await waitForOpen(bob);
    bob.send(JSON.stringify({ type: "join", room: "DUPLICATE", peerId: "bob" }));
    expect(await nextMessage(bob)).toMatchObject({ type: "joined", peers: ["alice"] });
    expect(await nextMessage(alice)).toMatchObject({ type: "peer-joined", peerId: "bob" });

    alice.close();
    duplicate.close();
    bob.close();
  }, 15000);

  it("registers push tokens for a room", async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "TEST-ROOM", token: "ExponentPushToken[test-token]" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
