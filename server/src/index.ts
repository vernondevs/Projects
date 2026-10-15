import express from "express";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "../../shared/protocol";
import { accountRouter } from "./accounts";
import { newSave } from "./game/Player";
import { ArenaStore } from "./arena/store";
import { services } from "./arena/registry";
import { GameDB } from "./db";
import { ArenaRoom } from "./rooms/ArenaRoom";
import { homeCity } from "../../shared/cities";
import { classFaction } from "../../shared/classes";
import { WorldRoom } from "./rooms/WorldRoom";

const PORT = Number(process.env.PORT || 2567);

const app = express();
app.set("trust proxy", "loopback");
app.use(
  "/api",
  accountRouter({
    db: () => WorldRoom.db,
    map: () => WorldRoom.instance?.world.map ?? null,
    online: (key) => !!WorldRoom.instance?.world.findByName(key),
    // новый герой появляется в столице своей фракции
    newSave: (cls) => newSave(cls, homeCity(classFaction(cls)).spawn),
    test: process.env.TEST_MODE === "1",
  }),
);
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.get("/api/top", (_req, res) => {
  res.json(WorldRoom.db.top(10));
});
app.get("/api/arena/top/:mode", (req, res) => {
  const mode = req.params.mode === "2v2" ? "2v2" : "1v1";
  res.json({ season: services.arena.season(), mode, rows: services.arena.top(mode) });
});
const dist = path.resolve("dist");
if (fs.existsSync(path.join(dist, "index.html"))) app.use(express.static(dist));

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }), greet: false });

WorldRoom.db = new GameDB();
services.db = WorldRoom.db;
services.arena = new ArenaStore(WorldRoom.db.raw);
gameServer.define(ROOM_NAME, WorldRoom);
gameServer.define("arena", ArenaRoom);

await gameServer.listen(PORT);
await matchMaker.createRoom(ROOM_NAME, {});
console.log(`[server] Пепельный Предел: http://localhost:${PORT}  (ws на том же порту)`);
if (!fs.existsSync(path.join(dist, "index.html"))) console.log("[server] Клиент в режиме разработки: http://localhost:5173");

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await gameServer.gracefullyShutdown(false);
  } finally {
    WorldRoom.db.close();
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
