import { matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import { ARENA_MODES, MODE_NAMES, rankOf, TEAM_SIZE, type ArenaInfo, type ArenaMode, type ModeRating } from "../../../shared/arena";
import { STAT_NAMES, type StatKey } from "../../../shared/classes";
import { PATCH_MS, SAVE_INTERVAL_MS, TICK_MS } from "../../../shared/constants";
import { LOGOUT_CODE, LOGOUT_COMBAT_MS } from "../../../shared/accounts";
import { freshChars, sessionOf } from "../accounts";
import { xpToNext } from "../../../shared/formulas";
import { MOUNTS } from "../../../shared/mounts";
import { buyPet, selectPet, togglePet } from "../game/Pet";
import { MERCHANT_RANGE, PLAYER_RADIUS } from "../../../shared/constants";
import { MAP_VERSION, walkable } from "../../../shared/map";
import { makeItem, makeUnique, Rarity } from "../../../shared/items";
import type { JoinOptions } from "../../../shared/protocol";
import { canLearn, SKILLS } from "../../../shared/skills";
import { Parties } from "../arena/party";
import { ArenaQueue, type PendingMatch } from "../arena/queue";
import { inArena, services } from "../arena/registry";
import { deliverArenaRewards } from "../arena/rewards";
import { GameDB, type PlayerSave } from "../db";
import { sendPrices, setMarketDb } from "../game/market";
import { buyMaterial, upgradeItem } from "../game/smith";
import { registerAdmin } from "../game/admin";
import { registerEncounters } from "../game/encounters";
import { registerBiomes, sendNodes } from "../game/biomes";
import { questProgress, registerCities } from "../game/cities";
import { addItem, buy, buyFood, nearMerchant, equip, pickup, sell, swap, unequip, useItem } from "../game/inventory";
import { Player } from "../game/Player";
import { gainXp } from "../game/rewards";
import { forgetRumors, rumorFor } from "../game/rumors";
import { World } from "../game/World";
import { TradeManager } from "../trade/TradeManager";
import { BankService } from "../game/bank";
import { expandBag } from "../game/bags";
import type { ArenaOptions, Participant } from "./ArenaRoom";
import { makeOn, registerCombat, type On } from "./common";
import { WorldState } from "./schema";

interface AuthResult {
  name: string;
  save: PlayerSave;
  created: boolean;
  fromArena?: boolean;
  accountId?: number;
}

export class WorldRoom extends Room<WorldState> {
  override maxClients = 200;
  override autoDispose = false;
  world!: World;
  parties!: Parties;
  queue!: ArenaQueue;
  trade!: TradeManager;
  bank!: BankService;
  static db: GameDB;
  /** Единственная комната мира (для HTTP API аккаунтов: карта, кто онлайн). */
  static instance: WorldRoom | null = null;
  db() {
    return WorldRoom.db;
  }

  override onCreate() {
    WorldRoom.instance = this;
    setMarketDb(WorldRoom.db);
    this.setState(new WorldState());
    this.setPatchRate(PATCH_MS);
    this.world = new World(this.state, (type, msg) => this.broadcast(type, msg));
    this.setSimulationInterval((dt) => this.world.update(dt), TICK_MS);
    const find = (key: string) => this.world.findByName(key);
    this.parties = new Parties(find, (key) => !!find(key) || inArena.has(key));
    this.queue = new ArenaQueue(services.arena, find, (m) => void this.startMatch(m), (keys) => keys.forEach((k) => this.sendArenaInfo(k)));
    this.trade = new TradeManager(() => this.world, () => WorldRoom.db, (p) => p.goingToArena || inArena.has(p.name.toLowerCase()), () => this.world.map.playerSpawn);
    this.clock.setInterval(() => this.trade.tick(), 1000);
    this.bank = new BankService(() => this.world, () => WorldRoom.db, () => this.world.map.playerSpawn, (p) => p.goingToArena || inArena.has(p.name.toLowerCase()), (p, i) => this.trade.locked(p, i));
    const on = makeOn(this, () => this.world);
    registerCombat(on, () => this.world);
    this.registerMessages(on);
    this.registerArena(on);
    registerAdmin(this, on);
    registerEncounters(on, () => this.world);
    registerBiomes(on, () => this.world);
    registerCities(on, () => this.world);
    if (process.env.TEST_MODE === "1") this.registerDebug(on);
    this.clock.setInterval(() => this.saveAll(), SAVE_INTERVAL_MS);
    this.clock.setInterval(() => this.queue.tick(), 1000);
    this.clock.setInterval(() => this.tickLogouts(), 200);
    this.clock.setInterval(() => this.checkSeason(), 60_000);
    this.checkSeason();
  }

  /** Вход героя аккаунта: токен сессии HTTP API + имя героя (герой должен принадлежать аккаунту). */
  override async onAuth(_client: Client, options: JoinOptions): Promise<AuthResult> {
    const sess = sessionOf(options?.token);
    if (!sess) throw new ServerError(401, "Сессия истекла, войдите снова");
    const db = WorldRoom.db;
    const want = typeof options?.character === "string" ? options.character.trim() : "";
    if (!want || db.ownerOf(want) !== sess.accountId) throw new ServerError(403, "Этот герой не принадлежит аккаунту");
    const name = db.find(want)!.name;
    const key = GameDB.key(name);
    if (this.world.findByName(key)) throw new ServerError(409, "Этот герой уже в игре");
    if (inArena.has(key)) throw new ServerError(409, "Этот герой сейчас на арене");
    // на аккаунте одновременно играет один герой
    for (const c of db.charsOf(sess.accountId)) {
      const k = GameDB.key(c.name);
      if (this.world.findByName(k) || inArena.has(k)) throw new ServerError(409, `На аккаунте уже в игре другой герой: ${c.name}`);
    }
    const ban = db.banOf(name);
    if (ban) throw new ServerError(403, `Герой заблокирован ${ban.until > 4e12 ? "навсегда" : "до " + new Date(ban.until).toLocaleString("ru-RU")}${ban.reason ? ": " + ban.reason : ""}`);
    const save = db.load(name);
    if (!save) throw new ServerError(404, "Герой не найден");
    return { name, save, created: freshChars.delete(key), accountId: sess.accountId };
  }

  override onJoin(client: Client, _options: JoinOptions, auth: AuthResult) {
    // позиция из сохранения другой версии карты или в стене/воде — к фонтану
    const s = auth.save, map = this.world.map;
    if (s.mapVer !== MAP_VERSION || !walkable(map, s.x, s.y, PLAYER_RADIUS)) {
      s.x = map.playerSpawn.x;
      s.y = map.playerSpawn.y;
    }
    s.mapVer = MAP_VERSION;
    const p = new Player(client.sessionId, auth.name, auth.save, (type, msg) => client.send(type, msg));
    p.admin = WorldRoom.db.isAdmin(p.name);
    p.accountId = auth.accountId ?? WorldRoom.db.ownerOf(p.name) ?? 0;
    this.world.addPlayer(p, auth.fromArena ? `${p.name} возвращается с арены.` : undefined);
    client.send("welcome", { id: client.sessionId, seed: this.world.map.seed, created: auth.created });
    sendNodes(this.world, p);
    if (auth.created) client.send("toast", { text: "Добро пожаловать в Пепельный Предел!", kind: "level" });
    deliverArenaRewards(p);
    const key = p.name.toLowerCase();
    client.send("party", this.parties.state(key));
    for (const m of this.parties.members(key) ?? []) if (m.key !== key) this.world.findByName(m.key)?.send("party", this.parties.state(m.key));
    this.sendArenaInfo(key);
  }

  override onLeave(client: Client) {
    const p = this.world.players.get(client.sessionId);
    if (p) {
      forgetRumors(p.id);
      p.logout = null;
      this.trade.leave(p);
      this.world.breakMount(p);
      WorldRoom.db.save(p.name, p.toSave(this.world.map.playerSpawn));
      const key = p.name.toLowerCase();
      if (!p.goingToArena) {
        this.queue.drop(key);
        this.parties.leave(key);
      }
    }
    this.world.removePlayer(client.sessionId, p?.goingToArena ? `${p.name} отправляется на арену.` : undefined);
  }

  override onDispose() {
    this.saveAll();
    if (WorldRoom.instance === this) WorldRoom.instance = null;
  }

  // ---------- выход из игры (задача 29) ----------
  /** Вне боя — сразу; в бою — отсчёт LOGOUT_COMBAT_MS, полученный урон его прерывает. */
  private requestLogout(p: Player) {
    if (p.logout) return;
    if (p.goingToArena) return p.send("logout:cancel", { reason: "Идёт переход на арену" });
    const t = this.world.time;
    if (p.inCombat(t)) {
      p.logout = { start: t, end: t + LOGOUT_COMBAT_MS };
      p.input = { mx: 0, my: 0 };
      p.moveTo = null;
      p.send("logout:wait", { ms: LOGOUT_COMBAT_MS });
      return;
    }
    this.finishLogout(p);
  }
  private cancelLogout(p: Player, reason: string) {
    if (!p.logout) return;
    p.logout = null;
    p.send("logout:cancel", { reason });
    if (reason) p.send("toast", { text: reason, kind: "error" });
  }
  private tickLogouts() {
    const t = this.world.time;
    for (const p of this.world.players.values()) {
      if (!p.logout) continue;
      if (p.hurtAt > p.logout.start) this.cancelLogout(p, "Выход прерван: вы получили урон");
      else if (t >= p.logout.end) this.finishLogout(p);
    }
  }
  /** Завершение: сохранение, отмена обмена, выход из очереди и группы, питомец и маунт убираются в onLeave. */
  private finishLogout(p: Player) {
    p.logout = null;
    const client = this.clients.find((c) => c.sessionId === p.id);
    if (!client) return;
    p.send("logout:ok", {});
    client.leave(LOGOUT_CODE);
  }

  saveAll() {
    for (const p of this.world.players.values()) WorldRoom.db.save(p.name, p.toSave(this.world.map.playerSpawn));
  }

  // ---------- арена ----------
  private checkSeason() {
    const closed = services.arena.closeSeasonIfDue();
    if (closed !== null) this.onSeasonClosed(closed);
  }
  private onSeasonClosed(id: number) {
    this.world.system(`Сезон арены ${id} завершён! Награды выданы, рейтинги частично сброшены.`);
    for (const p of this.world.players.values()) {
      deliverArenaRewards(p);
      this.sendArenaInfo(p.name.toLowerCase());
    }
  }

  arenaInfo(key: string): ArenaInfo {
    const store = services.arena;
    const season = store.season();
    const ratings = {} as Record<ArenaMode, ModeRating>;
    for (const mode of ARENA_MODES) {
      const r = store.rating(key, mode);
      ratings[mode] = { ...r, rank: rankOf(r.rating).id, place: store.place(key, mode) };
    }
    const p = this.world.findByName(key);
    return {
      season: { id: season.id, endsAt: season.ends, now: Date.now() },
      ratings,
      queue: this.queue.status(key),
      pending: !!this.queue.pendingOf(key),
      party: this.parties.state(key),
      titles: (p?.save.titles ?? []).map((t) => t.name),
      title: p?.save.title ?? "",
      frame: p?.save.frame ?? "",
    };
  }
  sendArenaInfo(key: string) {
    this.world.findByName(key)?.send("arena:info", this.arenaInfo(key));
  }

  /** Все подтвердили матч: сохраняем героев, создаём инстанс арены и резервируем места. */
  private async startMatch(m: PendingMatch) {
    const keys = m.teams.flatMap((t) => t.flatMap((e) => e.members));
    const players = keys.map((k) => this.world.findByName(k));
    if (players.some((p) => !p || p.dead)) {
      for (const p of players) p?.send("arena:cancelled", { reason: "Кто-то из участников недоступен. Встаньте в очередь снова" });
      return;
    }
    const season = services.arena.season().id;
    const participants: Participant[] = [];
    m.teams.forEach((t, ti) => {
      for (const e of t) for (const k of e.members) {
        const p = this.world.findByName(k)!;
        participants.push({ name: p.name, nameKey: k, cls: p.cls, level: p.level, team: ti + 1, rating: e.ratings[k] });
      }
      for (const b of m.bots?.[ti] ?? []) participants.push({ name: b.name, nameKey: b.nameKey, cls: b.cls, level: b.level, team: ti + 1, rating: b.rating, bot: b.save });
    });
    for (const p of players as Player[]) {
      inArena.add(p.name.toLowerCase());
      p.goingToArena = true;
      this.world.breakMount(p);
      p.input = { mx: 0, my: 0 };
      p.moveTo = null;
      WorldRoom.db.save(p.name, p.toSave(this.world.map.playerSpawn));
    }
    try {
      const options: ArenaOptions = { mode: m.mode, season, participants, bots: !!m.bots };
      const room = await matchMaker.createRoom("arena", options);
      for (const p of players as Player[]) {
        const res = await matchMaker.reserveSeatFor(room, {}, { name: p.name, save: JSON.parse(JSON.stringify(p.save)) });
        p.send("arena:go", { mode: m.mode, reservation: { sessionId: res.sessionId, room: { name: "arena", roomId: room.roomId, processId: room.processId } } });
      }
    } catch (e) {
      console.error("[arena] не удалось создать матч:", e);
      for (const p of players as Player[]) {
        inArena.delete(p.name.toLowerCase());
        p.goingToArena = false;
        p.send("arena:cancelled", { reason: "Не удалось создать арену, попробуйте ещё раз" });
      }
    }
  }

  private registerArena(on: On) {
    const key = (p: Player) => p.name.toLowerCase();
    on("arena:info", (p) => this.sendArenaInfo(key(p)));
    on<{ mode: unknown }>("arena:queue", (p, m) => {
      const mode = m.mode as ArenaMode;
      if (!ARENA_MODES.includes(mode)) return;
      if (p.goingToArena) return;
      let group = [p];
      const party = this.parties.members(key(p));
      if (mode === "2v2" && party && party.length === TEAM_SIZE["2v2"]) {
        const mates = party.map((x) => this.world.findByName(x.key));
        if (mates.some((x) => !x)) return p.send("toast", { text: "Напарник по группе не в мире", kind: "error" });
        group = mates as Player[];
      }
      const err = this.queue.join(group, mode);
      if (err) return p.send("toast", { text: err, kind: "error" });
      for (const g of group) g.send("toast", { text: `Очередь арены ${MODE_NAMES[mode]}${group.length > 1 ? " с группой" : ""}: ищем соперников`, kind: "info" });
    });
    on("arena:cancel", (p) => this.queue.cancel(key(p)));
    on("arena:accept", (p) => this.queue.accept(key(p)));
    on("arena:decline", (p) => this.queue.decline(key(p)));
    on<{ mode: unknown }>("arena:top", (p, m) => {
      const mode = m.mode as ArenaMode;
      if (ARENA_MODES.includes(mode)) p.send("arena:top", { mode, rows: services.arena.top(mode) });
    });
    on("arena:history", (p) => p.send("arena:history", services.arena.history(key(p))));
    on<{ name: unknown }>("arena:title", (p, m) => {
      const t = typeof m.name === "string" ? (p.save.titles ?? []).find((x) => x.name === m.name) : undefined;
      p.save.title = t?.name ?? "";
      p.save.frame = t?.rank ?? "";
      p.applyCosmetics();
      this.sendArenaInfo(key(p));
    });
    on<{ name: unknown }>("party:invite", (p, m) => {
      if (typeof m.name !== "string") return;
      const err = this.parties.invite(p, m.name);
      p.send("toast", { text: err ?? `Приглашение отправлено: ${m.name}`, kind: err ? "error" : "info" });
    });
    on<{ accept: unknown }>("party:respond", (p, m) => {
      const err = this.parties.respond(p, m.accept === true);
      if (err) p.send("toast", { text: err, kind: "error" });
      for (const x of this.parties.members(key(p)) ?? []) this.sendArenaInfo(x.key);
    });
    on("party:leave", (p) => {
      const mates = this.parties.members(key(p)) ?? [];
      for (const x of mates) this.queue.cancel(x.key);
      this.parties.leave(key(p));
      for (const x of mates) this.sendArenaInfo(x.key);
    });
  }

  private registerMessages(on: On) {
    const w = () => this.world;
    on("respawn", (p) => w().respawn(p));
    on("logout:request", (p) => this.requestLogout(p));
    on("logout:cancel", (p) => this.cancelLogout(p, ""));
    on<{ id: unknown }>("mount:select", (p, m) => {
      if (typeof m.id !== "string" || !p.save.mounts?.includes(m.id)) return;
      p.save.mount = m.id;
      p.selfDirty = true;
    });
    on("pet:toggle", (p) => togglePet(w(), p));
    on<{ id: unknown }>("pet:select", (p, m) => typeof m.id === "string" && selectPet(w(), p, m.id));
    on<{ id: unknown }>("pet:buy", (p, m) => {
      if (typeof m.id !== "string" || p.dead) return;
      if (!nearMerchant(w(), p)) return p.send("toast", { text: "Подойдите к торговке", kind: "error" });
      buyPet(w(), p, m.id);
    });
    on<{ id: unknown }>("mount:buy", (p, m) => {
      const def = typeof m.id === "string" ? MOUNTS[m.id] : undefined;
      const err = (text: string) => p.send("toast", { text, kind: "error" });
      if (!def || p.dead) return;
      if (!nearMerchant(w(), p)) return err("Подойдите к торговке");
      if (p.save.mounts?.includes(def.id)) return err("Маунт уже у вас");
      if (p.level < def.level) return err(`${def.name}: нужен ${def.level} уровень`);
      if (def.price <= 0 || p.save.gold < def.price) return err("Не хватает золота");
      p.save.gold -= def.price;
      (p.save.mounts ??= []).push(def.id);
      p.save.mount = def.id;
      p.selfDirty = true;
      p.send("toast", { text: `Получен маунт: ${def.name}`, kind: "loot" });
    });
    on<{ npc: unknown }>("rumor", (p, m) => {
      const r = rumorFor(w(), p, m.npc);
      if (r) p.send("rumor", r);
    });
    on<{ stat: unknown }>("alloc", (p, m) => {
      if (typeof m.stat !== "string" || !(m.stat in STAT_NAMES)) return;
      if (!p.allocate(m.stat as StatKey)) p.send("toast", { text: "Нет свободных очков", kind: "error" });
    });
    on<{ id: unknown }>("learn", (p, m) => {
      const def = typeof m.id === "string" ? SKILLS[m.id] : undefined;
      if (!def || def.cls !== p.cls) return;
      const why = canLearn(def, p.save.skills, p.level, p.skillPoints());
      if (why) return p.send("toast", { text: why, kind: "error" });
      p.save.skills[def.id] = (p.save.skills[def.id] || 0) + 1;
      p.recalc();
      p.send("toast", { text: `${def.name}: ранг ${p.save.skills[def.id]}`, kind: "info" });
    });
    const lock = (p: Player, ...idx: unknown[]) => {
      if (!idx.some((i) => this.trade.locked(p, i))) return false;
      p.send("toast", { text: "Предмет лежит в окне обмена", kind: "error" });
      return true;
    };
    on<{ index: unknown }>("equip", (p, m) => !lock(p, m.index) && equip(w(), p, m.index));
    on<{ slot: unknown }>("unequip", (p, m) => unequip(p, m.slot));
    on<{ index: unknown }>("use", (p, m) => !lock(p, m.index) && useItem(w(), p, m.index));
    on<unknown>("market:get", (p) => sendPrices(p));
    on<{ index: unknown }>("sell",(p, m) => !lock(p, m.index) && sell(w(), p, m.index));
    on<{ a: unknown; b: unknown }>("swap", (p, m) => !lock(p, m.a, m.b) && swap(p, m.a, m.b));
    // обмен
    on<{ id: unknown }>("trade:request", (p, m) => this.trade.request(p, m.id));
    on<{ accept: unknown }>("trade:respond", (p, m) => this.trade.respond(p, m.accept === true));
    on<{ index: unknown; slot: unknown }>("trade:add", (p, m) => this.trade.add(p, m.index, m.slot));
    on<{ slot: unknown }>("trade:remove", (p, m) => this.trade.remove(p, m.slot));
    on<{ v: unknown }>("trade:gold", (p, m) => this.trade.gold(p, m.v));
    on("trade:ready", (p) => this.trade.ready(p));
    on("trade:confirm", (p) => this.trade.confirm(p));
    on("trade:cancel", (p) => this.trade.cancel(p.name.toLowerCase(), `Обмен отменён: ${p.name} закрывает окно`));
    on<{ base: unknown; qty: unknown }>("buy", (p, m) => buy(w(), p, m.base, m.qty));
    on<{ id: unknown; qty: unknown }>("cook:buy", (p, m) => buyFood(w(), p, m.id, m.qty));
    on<{ id: unknown; qty: unknown }>("smith:buy", (p, m) => buyMaterial(w(), p, m.id, m.qty));
    on<{ index: unknown; slot: unknown }>("smith:upgrade", (p, m) => upgradeItem(w(), p, m.index, m.slot, (i) => this.trade.locked(p, i)));
    on<{ bag: unknown }>("pickup", (p, m) => pickup(w(), p, m.bag));
    // банк
    on("bag:expand", (p) => expandBag(w(), WorldRoom.db, w().map.playerSpawn, p, p.goingToArena || inArena.has(p.name.toLowerCase())));
    on("bank:open", (p) => this.bank.open(p));
    on<{ index: unknown; tab: unknown; slot: unknown }>("bank:put", (p, m) => this.bank.put(p, m.index, m.tab, m.slot));
    on<{ tab: unknown; slot: unknown; index: unknown }>("bank:take", (p, m) => this.bank.take(p, m.tab, m.slot, m.index));
    on<{ tab: unknown; slot: unknown; toTab: unknown; toSlot: unknown }>("bank:move", (p, m) => this.bank.move(p, m.tab, m.slot, m.toTab, m.toSlot));
    on<{ v: unknown }>("bank:gold", (p, m) => this.bank.gold(p, m.v));
    on("bank:buy", (p) => this.bank.buy(p));
  }

  /** Отладочные команды только для автотестов (TEST_MODE=1). */
  private registerDebug(on: On) {
    const w = () => this.world;
    on<{ op: string; [k: string]: unknown }>("dbg", (p, m) => {
      switch (m.op) {
        case "tp": p.unit.x = Number(m.x); p.unit.y = Number(m.y); p.moveTo = null; break;
        case "xp": gainXp(w(), p, Number(m.v)); break;
        case "level": { const lv = Number(m.v); while (p.level < lv) gainXp(w(), p, xpToNext(p.level) - p.save.xp); break; }
        case "gold": p.save.gold += Number(m.v); p.selfDirty = true; break;
        case "hp": p.unit.hp = Math.max(1, Number(m.v)); break;
        case "god": p.unit.maxHp = 999999; p.unit.hp = 999999; break;
        case "drop": p.forceDrop = !!m.v; break;
        case "item": addItem(p, m.unique ? makeUnique(String(m.unique)) : makeItem(String(m.base), Number(m.ilvl || 1), Number(m.rarity || 0) as Rarity)); break;
        case "mobhp": { const mob = w().mobs.get(String(m.id)); if (mob) mob.unit.hp = Math.max(1, Math.round(mob.unit.maxHp * Number(m.v))); break; }
        case "hurt": w().applyDamage(p, Number(m.v)); break;
        case "qp": questProgress(p, m.kind === "gather" ? "gather" : "kill", String(m.target), Number(m.n || 1)); break;
        case "calm": p.combatAt = -1e9; break;
        case "fight": p.combatAt = w().time; break;
        case "fill": for (let i = 0; i < p.save.inventory.length; i++) if (!p.save.inventory[i]) p.save.inventory[i] = makeItem("ring", 1, Rarity.Common); break;
        case "rating": services.arena.setRating(p.name.toLowerCase(), p.name, p.cls, m.mode as ArenaMode, Number(m.v)); this.sendArenaInfo(p.name.toLowerCase()); break;
        case "season:end": { const id = services.arena.closeSeasonIfDue(Date.now(), true); if (id !== null) this.onSeasonClosed(id); break; }
      }
      p.selfDirty = true;
    });
  }
}
