export interface MobDef {
  id: string;
  name: string;
  /** Имя спрайт-листа в client/public/assets/units. */
  sprite: string;
  /** 1 — кадр 32×32, 2 — кадр 64×64 (боссы). */
  size: 1 | 2;
  hp: number;
  dmg: number;
  armor: number;
  xp: number;
  speed: number;
  aggro: number;
  range: number;
  attackCd: number;
  projectile?: string;
  radius: number;
  boss?: boolean;
  /** Боссы: фиксированный уровень, время возрождения и уникальный лут. */
  level?: number;
  respawn?: number;
  uniques?: string[];
  color: string;
}

export const MOBS: Record<string, MobDef> = {
  slime: { id: "slime", name: "Слизень", sprite: "slime", size: 1, hp: 0.7, dmg: 0.7, armor: 0.5, xp: 0.8, speed: 55, aggro: 120, range: 34, attackCd: 1.4, radius: 11, color: "#7bd66b" },
  boar: { id: "boar", name: "Кабан", sprite: "boar", size: 1, hp: 1.1, dmg: 1.0, armor: 1, xp: 1, speed: 85, aggro: 140, range: 36, attackCd: 1.5, radius: 12, color: "#a0704e" },
  goblin: { id: "goblin", name: "Гоблин", sprite: "goblin", size: 1, hp: 0.9, dmg: 1.1, armor: 0.8, xp: 1.05, speed: 80, aggro: 160, range: 36, attackCd: 1.2, radius: 10, color: "#7aa83c" },
  wolf: { id: "wolf", name: "Серый волк", sprite: "wolf", size: 1, hp: 1, dmg: 1.1, armor: 0.8, xp: 1, speed: 110, aggro: 190, range: 38, attackCd: 1.1, radius: 12, color: "#8e94a0" },
  spider: { id: "spider", name: "Лесной паук", sprite: "spider", size: 1, hp: 0.9, dmg: 1.2, armor: 0.7, xp: 1.05, speed: 95, aggro: 160, range: 36, attackCd: 1.2, radius: 11, color: "#6b4c7a" },
  goblin_shaman: { id: "goblin_shaman", name: "Гоблин-шаман", sprite: "goblin_shaman", size: 1, hp: 0.8, dmg: 1.1, armor: 0.5, xp: 1.15, speed: 70, aggro: 220, range: 200, attackCd: 1.9, projectile: "shadow", radius: 10, color: "#5d8a3a" },
  skeleton: { id: "skeleton", name: "Скелет", sprite: "skeleton", size: 1, hp: 1, dmg: 1.1, armor: 1.2, xp: 1, speed: 75, aggro: 170, range: 38, attackCd: 1.3, radius: 10, color: "#ddd6c1" },
  drowned: { id: "drowned", name: "Утопленник", sprite: "drowned", size: 1, hp: 1.3, dmg: 1.0, armor: 0.8, xp: 1.1, speed: 60, aggro: 150, range: 38, attackCd: 1.6, radius: 11, color: "#5e8a7a" },
  toxic_slime: { id: "toxic_slime", name: "Ядовитый слизень", sprite: "toxic_slime", size: 1, hp: 0.9, dmg: 1.0, armor: 0.6, xp: 0.95, speed: 60, aggro: 150, range: 180, attackCd: 2.0, projectile: "poison", radius: 11, color: "#b2e04a" },
  imp: { id: "imp", name: "Огненный бес", sprite: "imp", size: 1, hp: 0.8, dmg: 1.2, armor: 0.6, xp: 1.1, speed: 100, aggro: 210, range: 190, attackCd: 1.6, projectile: "fire", radius: 10, color: "#e0603a" },
  golem: { id: "golem", name: "Лавовый голем", sprite: "golem", size: 1, hp: 1.8, dmg: 1.3, armor: 1.6, xp: 1.5, speed: 55, aggro: 150, range: 42, attackCd: 2.0, radius: 13, color: "#8a5040" },
  skeleton_knight: { id: "skeleton_knight", name: "Рыцарь-скелет", sprite: "skeleton_knight", size: 1, hp: 1.4, dmg: 1.25, armor: 1.6, xp: 1.3, speed: 80, aggro: 200, range: 40, attackCd: 1.3, radius: 11, color: "#b8b4c8" },
  sapling: { id: "sapling", name: "Саженец", sprite: "sapling", size: 1, hp: 0.45, dmg: 0.7, armor: 0.5, xp: 0.25, speed: 75, aggro: 400, range: 34, attackCd: 1.3, radius: 10, color: "#6fae4a" },

  ent: {
    id: "ent", name: "Древний Энт", sprite: "ent", size: 2, boss: true, level: 14, respawn: 120, hp: 16, dmg: 1.5, armor: 1.5, xp: 25,
    speed: 48, aggro: 250, range: 70, attackCd: 2.2, radius: 26, color: "#4f7a32",
    uniques: ["heartwood_staff", "rootbreaker", "whisperwind", "bark_helm"],
  },
  witch: {
    id: "witch", name: "Болотная Ведьма", sprite: "witch", size: 2, boss: true, level: 22, respawn: 150, hp: 18, dmg: 1.4, armor: 1.2, xp: 28,
    speed: 70, aggro: 290, range: 240, attackCd: 1.7, projectile: "poison", radius: 22, color: "#7a4e9a",
    uniques: ["hexed_ring", "bog_mantle", "witch_eye", "swamp_treads"],
  },
  ashlord: {
    id: "ashlord", name: "Повелитель Пепла", sprite: "ashlord", size: 2, boss: true, level: 30, respawn: 180, hp: 22, dmg: 1.6, armor: 1.8, xp: 35,
    speed: 72, aggro: 330, range: 80, attackCd: 2.0, radius: 26, color: "#d0482a",
    uniques: ["ashbringer", "cinder_staff", "phoenix_bow", "ashen_crown"],
  },
};
