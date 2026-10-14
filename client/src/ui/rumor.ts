/** Диалог городского сплетника: имя NPC, один слух, кнопки «Ещё слух» и «Пока». */
import type { RumorMsg } from "../../../shared/rumors";
import type { Net } from "../net";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class RumorUI {
  private win = document.createElement("div");
  private net!: Net;
  private npc = "";
  private name = "";
  private coolUntil = 0;

  constructor(root: HTMLElement) {
    this.win.className = "panel win win-rumor";
    this.win.hidden = true;
    root.append(this.win);
  }

  bind(net: Net) {
    this.net = net;
    net.on("rumor", (m) => {
      if (m.npc === this.npc) this.render(m);
    });
  }

  open(npc: string, name: string) {
    this.npc = npc;
    this.name = name;
    this.win.hidden = false;
    this.render(null);
    this.ask();
  }
  close(): boolean {
    const was = !this.win.hidden;
    this.win.hidden = true;
    return was;
  }

  private ask() {
    this.coolUntil = performance.now() + 1000;
    this.net.send("rumor", { npc: this.npc });
  }

  private render(m: RumorMsg | null) {
    this.win.innerHTML = `<h2><span>${esc(this.name)}</span><button class="x" aria-label="Закрыть">×</button></h2>
      <p class="rumor-text">${m ? esc(m.text) : "<span class=\"muted\">…</span>"}</p>
      <div class="rumor-btns"><button class="btn small more">Ещё слух</button><button class="btn small bye">Пока</button></div>`;
    this.win.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.close();
    this.win.querySelector<HTMLButtonElement>(".bye")!.onclick = () => this.close();
    const more = this.win.querySelector<HTMLButtonElement>(".more")!;
    more.onclick = () => {
      if (performance.now() < this.coolUntil) return;
      this.render(null);
      this.ask();
    };
  }
}
