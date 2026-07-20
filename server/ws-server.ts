/**
 * Optional realtime relay.
 *
 * The core sync engine (src/lib/sync/sync-engine.ts) works over plain HTTP
 * and is what satisfies the assignment's actual requirement: offline queueing,
 * background push/pull on reconnect. It polls every 15s and on online/offline
 * events, which is plenty for "eventually consistent, reconciles on
 * reconnect" — but it's not sub-second for two people typing at the same
 * time while both online.
 *
 * This relay is a thin, optional upgrade: it just broadcasts raw Yjs update
 * bytes between connected clients on the same documentId, with no business
 * logic and no persistence — the HTTP sync path remains the source of truth
 * for durability. If this process is down, the app is unaffected; clients
 * just fall back to the 15s poll cadence. Run alongside `next dev` with
 * `npm run ws-server`; deploy it separately from the Next.js app (e.g. a
 * small Fly.io/Render worker) since serverless platforms like Vercel don't
 * support long-lived WebSocket processes.
 */
import { WebSocketServer, type WebSocket } from "ws";

const PORT = Number(process.env.WS_PORT ?? 1234);
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map<string, Set<WebSocket>>();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "ws://localhost");
  const documentId = url.searchParams.get("doc");
  if (!documentId) {
    ws.close(1008, "missing doc id");
    return;
  }

  if (!rooms.has(documentId)) rooms.set(documentId, new Set());
  const room = rooms.get(documentId)!;
  room.add(ws);

  ws.on("message", (data, isBinary) => {
    if (!isBinary) return; // only relay binary Yjs update frames
    for (const peer of room) {
      if (peer !== ws && peer.readyState === peer.OPEN) peer.send(data, { binary: true });
    }
  });

  ws.on("close", () => {
    room.delete(ws);
    if (room.size === 0) rooms.delete(documentId);
  });
});

console.log(`[ws-server] realtime relay listening on :${PORT}`);
