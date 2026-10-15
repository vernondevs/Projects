import Phaser from "phaser";

export interface Manifest {
  units: Record<string, { frame: number }>;
  objects: Record<string, { w: number; h: number }>;
  icons: string[];
  fx: string[];
}

/** Загрузка всех ассетов по manifest.json и создание анимаций юнитов. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 150, height / 2, 0, 10, 0xf0c050).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 304, 14).setStrokeStyle(1, 0x8a6a4a);
    this.load.on("progress", (p: number) => (bar.width = 300 * p));
    this.load.json("manifest", "/assets/manifest.json");
    this.load.once("filecomplete-json-manifest", () => {
      const m = this.cache.json.get("manifest") as Manifest;
      this.load.image("coin_icon", "/assets/icons/coin.png");
      this.load.image("terrain", "/assets/tiles/terrain.png");
      this.load.image("water", "/assets/tiles/water.png");
      this.load.image("lava_glow", "/assets/tiles/lava_glow.png");
      for (const [id, u] of Object.entries(m.units)) this.load.spritesheet(`u_${id}`, `/assets/units/${id}.png`, { frameWidth: u.frame, frameHeight: u.frame });
      for (const id of Object.keys(m.objects)) this.load.image(`o_${id}`, `/assets/objects/${id}.png`);
      for (const id of m.fx) this.load.image(`fx_${id}`, `/assets/fx/${id}.png`);
    });
  }

  create() {
    const m = this.cache.json.get("manifest") as Manifest;
    for (const id of Object.keys(m.units)) {
      for (let row = 0; row < 3; row++) {
        const f = (a: number, b: number) => this.anims.generateFrameNumbers(`u_${id}`, { start: row * 12 + a, end: row * 12 + b });
        this.anims.create({ key: `${id}-walk-${row}`, frames: f(0, 3), frameRate: 8, repeat: -1 });
        this.anims.create({ key: `${id}-attack-${row}`, frames: f(4, 7), frameRate: 14, repeat: 0 });
        this.anims.create({ key: `${id}-death-${row}`, frames: f(8, 11), frameRate: 9, repeat: 0 });
      }
    }
    document.fonts.load('16px "Pixelify Sans"').finally(() => this.scene.start("game"));
  }
}
