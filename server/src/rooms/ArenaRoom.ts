/**
 * Инстанс арены: отдельная комната на один матч со своей картой. Попасть сюда можно только по
 * резервации места из очереди (onAuth отклоняет прямые подключения). После боя сервер
 * резервирует место в мире, и игрок возвращается туда, где стоял перед матчем.
 */
import { matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import {
  arenaSpawn, COUNTDOWN_MS, eloDelta, generateArenaMap, MATCH_MS,
  type ArenaMode, type ArenaPlayerResult, type ArenaResultMsg,
} from "../../../shared/arena";
import type { ClassId } from "../../../shared/classes";
import { PATCH_MS, TICK_MS } from "../../../shared/constants";
import { ROOM_NAME } from "../../../shared/protocol";
import { RECONNECT_SEC } from "../../../shared/accounts";
import { activeSkills } from "../../../shared/skills";
import type { PlayerSave } from "../db";
import { Player } from "../game/Player";
import { World } from "../game/World";
import { inArena, matchMs, services } from "../arena/registry";
import { botThink } from "../arena/bots";
import { makeOn, registerCombat } from "./common";
import { ArenaState } from "./schema";

export interface Participant {
  name: string;
  nameKey: string;
  cls: ClassId;
  level: number;
  team: number;
  rating: number;
  /** Бот: его сохранение (герой создаётся на сервере, без клиента). */
  bot?: PlayerSave;
}
export interface ArenaOptions {
  mode: ArenaMode;
  season: number;
  participants: Participant[];
  /** Матч с ботами: без рейтинга и записи в историю. */
  bots?: boolean;
}
export interface ArenaAuth {
  name: string;
  save: PlayerSave;
}
interface Stat {
  damage: number;
  healing: number;
  kills: number;
  deaths: number;
  left: boolean;
}

const ARENA_MAP = generateArenaMap();
const NO_SHOW_MS = 15_000;
const STAY_AFTER_MS = 90_000;

export class ArenaRoom extends Room<ArenaState> {
  override autoDispose = true;
  world!: World;
  mode!: ArenaMode;
  season = 0;
  parts: Participant[] = [];
  byKey = new Map<string, Player>();
  stats = new Map<string, Stat>();
  phase: "waiting" | "countdown" | "fight" | "end" = "waiting";
  phaseAt = Date.now();
  fightAt = 0;
  result: ArenaResultMsg | null = null;
  readonly matchLength = matchMs(MATCH_MS);
  withBots = false;
  bots: Player[] = [];
  private thinkAt = 0;

  override onCreate(o: ArenaOptions) {
    this.setPrivate(true);
    this.setSeatReservationTime(20);
    this.mode = o.mode;
    this.season = o.season;
    this.parts = o.participants;
    this.withBots = !!o.bots;
    this.maxClients = this.parts.filter((x) => !x.bot).length;
    this.setState(new ArenaState());
    this.state.mode = this.mode;
    this.state.phase = "waiting";
    this.world = new World(this.state, (t, m) => this.broadcast(t, m), { map: ARENA_MAP, mobs: false, quiet: true });
    for (const p of this.parts) this.stats.set(p.nameKey, { damage: 0, healing: 0, kills: 0, deaths: 0, left: false });
    const stat = (p: Player) => this.stats.get(p.name.toLowerCase());
    this.world.onDamage = (src, dst, v) => {
      if (this.phase !== "fight" || !this.world.isPlayer(src) || !this.world.isPlayer(dst)) return;
      stat(src)!.damage += v;
    };
    this.world.onHeal = (p, v) => {
      if (this.phase === "fight") stat(p)!.healing += v;
    };
    this.world.onPlayerKilled = (p, killer) => {
      if (this.phase !== "fight") return;
      stat(p)!.deaths++;
      if (killer && this.world.isPlayer(killer)) stat(killer)!.kills++;
      this.world.system(`${p.name} повержен${killer && this.world.isPlayer(killer) ? ` (${killer.name})` : ""}`);
    };
    const on = makeOn(this, () => this.world);
    registerCombat(on, () => this.world);
    this.onMessage("ping", (c) => c.send("pong", 0)); // сторож связи клиента
    this.onMessage("arena:leave", (client) => void this.sendHome(client));
    this.parts.forEach((x, i) => {
      if (!x.bot) return;
      const p = new Player(`bot${i}_${this.roomId}`, x.name, x.bot, () => {});
      this.place(p, x);
      this.bots.push(p);
    });
    this.setPatchRate(PATCH_MS);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);
  }

  override onAuth(): never {
    throw new ServerError(403, "Арена доступна только через очередь");
  }

  override onJoin(client: Client, _o: unknown, auth: ArenaAuth) {
    const key = auth.name.toLowerCase();
    const part = this.parts.find((x) => x.nameKey === key);
    if (!part || this.byKey.has(key) || this.phase === "end") throw new ServerError(403, "Вы не участник этого матча");
    const id = client.sessionId; // после переподключения объект клиента другой — ищем актуальный
    const p = new Player(id, auth.name, auth.save, (type, msg) => this.clients.find((c) => c.sessionId === id)?.send(type, msg));
    this.place(p, part);
    this.welcome(client, part);
  }

  private welcome(client: Client, part: Participant) {
    client.send("welcome", {
      id: client.sessionId,
      arena: true,
      mode: this.mode,
      team: part.team,
      teams: [1, 2].map((t) => this.parts.filter((x) => x.team === t).map((x) => ({ name: x.name, cls: x.cls, level: x.level, rating: x.rating }))),
    });
  }

  /** Ставит героя (игрока или бота) на точку своей команды. */
  private place(p: Player, part: Participant) {
    p.team = part.team;
    p.unit.team = part.team;
    p.frozenUntil = Infinity;
    const sp = arenaSpawn(part.team, this.parts.filter((x) => x.team === part.team).indexOf(part));
    p.unit.x = sp.x;
    p.unit.y = sp.y;
    this.world.addPlayer(p);
    this.byKey.set(part.nameKey, p);
  }

  override async onLeave(client: Client, consented: boolean) {
    const p = this.world.players.get(client.sessionId);
    if (!p) return;
    const key = p.name.toLowerCase();
    // обрыв связи во время матча: герой ждёт RECONNECT_SEC, бой идёт; не вернулся — поражение
    if (!consented && this.phase !== "end") {
      p.input = { mx: 0, my: 0 };
      p.moveTo = null;
      p.targetId = null;
      try {
        const fresh = await this.allowReconnection(client, Number(process.env.RECONNECT_SEC) || RECONNECT_SEC);
        const part = this.parts.find((x) => x.nameKey === key);
        if (part && this.world.players.get(client.sessionId) === p) {
          this.welcome(fresh, part);
          p.selfDirty = true;
          if (this.result) fresh.send("arena:result", this.result);
          return;
        }
      } catch {}
      if (this.world.players.get(client.sessionId) !== p) return;
    }
    if (this.phase !== "end") {
      // выход или обрыв связи до конца матча — поражение
      this.stats.get(key)!.left = true;
      this.world.system(`${p.name} покидает арену — поражение`);
    }
    this.world.removePlayer(client.sessionId);
    this.byKey.delete(key);
    inArena.delete(key);
    if (this.phase === "fight" || this.phase === "countdown") this.checkEnd(Date.now());
  }

  override onDispose() {
    for (const p of this.parts) inArena.delete(p.nameKey);
  }

  private alive(team: number): Player[] {
    return this.parts
      .filter((x) => x.team === team && !this.stats.get(x.nameKey)!.left)
      .map((x) => this.byKey.get(x.nameKey))
      .filter((p): p is Player => !!p && !p.dead);
  }

  /** Полное восстановление: здоровье, мана, перезарядки, эффекты; точка появления. */
  private restore(p: Player) {
    const part = this.parts.find((x) => x.nameKey === p.name.toLowerCase())!;
    const sp = arenaSpawn(part.team, this.parts.filter((x) => x.team === part.team).indexOf(part));
    p.dead = false;
    p.unit.anim = 0;
    p.unit.x = sp.x;
    p.unit.y = sp.y;
    p.unit.hp = p.unit.maxHp;
    p.unit.mp = p.unit.maxMp;
    p.targetId = null;
    p.moveTo = null;
    p.input = { mx: 0, my: 0 };
    p.stunUntil = p.rootUntil = p.slowUntil = p.warcryUntil = p.hasteUntil = p.blockUntil = p.weakUntil = p.lastStandUntil = p.lastStandReady = p.poisonUntil = p.burnUntil = 0;
    p.attackAt = 0;
    p.cds.clear();
    for (const s of activeSkills(p.cls)) p.send("cd", { id: s.id, ms: 0 });
  }

  private tick(dt: number) {
    this.world.update(dt);
    const now = Date.now();
    switch (this.phase) {
      case "waiting":
        if (this.byKey.size === this.parts.length || now - this.phaseAt > NO_SHOW_MS) this.beginCountdown(now);
        break;
      case "countdown": {
        const left = COUNTDOWN_MS - (now - this.phaseAt);
        this.state.countdown = Math.max(0, Math.ceil(left / 1000));
        if (left <= 0) this.beginFight(now);
        break;
      }
      case "fight":
        if (this.bots.length && now >= this.thinkAt) {
          this.thinkAt = now + 250;
          for (const b of this.bots) botThink(this.world, b, this.alive(b.team === 1 ? 2 : 1));
        }
        this.state.timeLeft = Math.max(0, Math.ceil((this.matchLength - (now - this.fightAt)) / 1000));
        this.checkEnd(now);
        break;
    }
  }

  private beginCountdown(now: number) {
    for (const x of this.parts) if (!this.byKey.has(x.nameKey)) this.stats.get(x.nameKey)!.left = true; // не пришёл — поражение
    this.phase = "countdown";
    this.phaseAt = now;
    this.state.phase = "countdown";
    this.state.countdown = Math.ceil(COUNTDOWN_MS / 1000);
    this.state.timeLeft = Math.ceil(this.matchLength / 1000);
    for (const p of this.byKey.values()) {
      this.restore(p);
      p.frozenUntil = Infinity;
    }
    if (!this.parts.some((x) => !x.bot && this.byKey.has(x.nameKey))) {
      this.finish(0, "leave", now, false);
      return;
    }
    this.checkEnd(now);
  }

  private beginFight(now: number) {
    if (this.phase !== "countdown") return;
    this.phase = "fight";
    this.fightAt = now;
    this.state.phase = "fight";
    this.world.pvpActive = true;
    for (const p of this.byKey.values()) {
      this.restore(p);
      p.frozenUntil = 0;
    }
    this.world.system("Бой начался!");
  }

  private checkEnd(now: number) {
    if (this.phase === "end") return;
    const a1 = this.alive(1).length, a2 = this.alive(2).length;
    const gone = (t: number) => this.parts.filter((x) => x.team === t).every((x) => this.stats.get(x.nameKey)!.left);
    if (!a1 || !a2) {
      const winner = !a1 && !a2 ? 0 : !a1 ? 2 : 1;
      const loser = winner === 1 ? 2 : 1;
      this.finish(winner, winner && gone(loser) ? "leave" : "kill", now);
      return;
    }
    if (this.phase === "fight" && now - this.fightAt >= this.matchLength) {
      const hp = (t: number) => this.alive(t).reduce((s, p) => s + (p.unit.hp / Math.max(1, p.unit.maxHp)) * 100, 0);
      const h1 = hp(1), h2 = hp(2);
      this.finish(Math.abs(h1 - h2) < 0.01 ? 0 : h1 > h2 ? 1 : 2, "time", now);
    }
  }

  /** Итог матча: Elo по среднему рейтингу команд, запись в базу, экран результатов. */
  private finish(winner: number, reason: ArenaResultMsg["reason"], now: number, record = true) {
    if (this.withBots) record = false; // бой с ботом: без Elo, истории и сезонных наград
    this.phase = "end";
    this.state.phase = "end";
    this.world.pvpActive = false;
    for (const p of this.byKey.values()) {
      p.frozenUntil = Infinity;
      p.targetId = null;
    }
    const avg = (t: number) => {
      const r = this.parts.filter((x) => x.team === t).map((x) => x.rating);
      return r.reduce((a, b) => a + b, 0) / r.length;
    };
    const duration = this.fightAt ? now - this.fightAt : 0;
    const players: ArenaPlayerResult[] = this.parts.map((x) => {
      const s = this.stats.get(x.nameKey)!;
      const score = s.left ? 0 : winner === 0 ? 0.5 : x.team === winner ? 1 : 0;
      const delta = this.withBots ? 0 : eloDelta(avg(x.team), avg(x.team === 1 ? 2 : 1), score);
      return {
        name: x.name, cls: x.cls, team: x.team, damage: Math.round(s.damage), healing: Math.round(s.healing), kills: s.kills, deaths: s.deaths,
        left: s.left, won: score === 1, draw: score === 0.5, ratingBefore: x.rating, ratingAfter: Math.max(0, x.rating + delta),
      };
    });
    this.result = { mode: this.mode, winner, reason, durationMs: duration, players, ...(this.withBots ? { bot: true } : {}) };
    if (record) {
      services.arena.recordMatch({
        mode: this.mode, season: this.season, started: this.fightAt || now, durationMs: duration, winner, reason,
        players: players.map((r, i) => ({
          nameKey: this.parts[i].nameKey, name: r.name, cls: r.cls, team: r.team,
          result: r.won ? "win" : r.draw ? "draw" : "loss",
          ratingBefore: r.ratingBefore, ratingAfter: r.ratingAfter,
          damage: r.damage, healing: r.healing, kills: r.kills, deaths: r.deaths, left: r.left,
        })),
      });
    }
    this.broadcast("arena:result", this.result);
    this.clock.setTimeout(() => this.disconnect(), STAY_AFTER_MS);
  }

  /** Возврат в мир на прежнее место: резервация места в комнате мира с сохранением из базы. */
  private async sendHome(client: Client) {
    if (this.phase !== "end") return;
    const p = this.world.players.get(client.sessionId);
    if (!p || p.goingHome) return;
    p.goingHome = true;
    try {
      const save = services.db.load(p.name);
      const [world] = await matchMaker.query({ name: ROOM_NAME });
      if (!save || !world) throw new Error("мир недоступен");
      const res = await matchMaker.reserveSeatFor(world, {}, { name: p.name, save, created: false, fromArena: true });
      client.send("arena:return", { reservation: { sessionId: res.sessionId, room: { name: ROOM_NAME, roomId: world.roomId, processId: world.processId } } });
    } catch (e) {
      p.goingHome = false;
      console.error("[arena] возврат в мир:", e);
      client.send("toast", { text: "Не удалось вернуться в мир, войдите заново", kind: "error" });
    }
  }
}
