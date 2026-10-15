/** Перетаскивание окон за заголовок. Один модуль на все .win (делегирование + MutationObserver). */
let zTop = 10;
let getName: () => string = () => "";
const known = new Set<HTMLElement>();
const key = () => `winpos:${getName()}`;

type Pos = Record<string, [number, number]>;
function load(): Pos { try { return JSON.parse(localStorage.getItem(key()) || "{}") || {}; } catch { return {}; } }
function save(id: string, l: number, t: number) { try { const p = load(); p[id] = [Math.round(l), Math.round(t)]; localStorage.setItem(key(), JSON.stringify(p)); } catch {} }

function winId(w: HTMLElement): string { return [...w.classList].find((c) => c.startsWith("win-")) || "win"; }
/** Масштаб CSS zoom корня: экранные пиксели на локальный. */
function scaleOf(w: HTMLElement): number { const s = w.getBoundingClientRect().width / (w.offsetWidth || 1); return s > 0 && isFinite(s) ? s : 1; }

function clamp(w: HTMLElement, l: number, t: number): [number, number] {
  const s = scaleOf(w), par = (w.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const minL = -par.left / s, minT = -par.top / s;
  const maxL = Math.max(minL, (window.innerWidth - par.left) / s - w.offsetWidth), maxT = Math.max(minT, (window.innerHeight - par.top) / s - w.offsetHeight);
  return [Math.min(maxL, Math.max(minL, l)), Math.min(maxT, Math.max(minT, t))];
}
function place(w: HTMLElement, l: number, t: number) {
  const [x, y] = clamp(w, l, t);
  const st = w.style;
  st.transform = "none"; st.right = "auto"; st.bottom = "auto"; st.left = x + "px"; st.top = y + "px";
  w.dataset.moved = "1";
}
/** Текущая локальная позиция окна (до первого перетаскивания берётся из вёрстки). */
function localPos(w: HTMLElement): [number, number] {
  const s = scaleOf(w), r = w.getBoundingClientRect(), par = (w.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return [(r.left - par.left) / s, (r.top - par.top) / s];
}
function restore(w: HTMLElement) {
  const p = load()[winId(w)];
  if (p) place(w, p[0], p[1]); else if (w.dataset.moved) place(w, ...localPos(w));
}

export function bringToFront(w: HTMLElement) { w.style.zIndex = String(++zTop); }

export function makeDraggable(win: HTMLElement, _id?: string) {
  if (known.has(win)) return;
  known.add(win);
  win.addEventListener("pointerdown", (e) => {
    bringToFront(win);
    const tgt = e.target as HTMLElement;
    const head = tgt.closest("h2");
    if (!head || !win.contains(head) || tgt.closest("button, input, select, a") || (e.pointerType === "mouse" && e.button !== 0)) return;
    const s = scaleOf(win);
    const [l0, t0] = localPos(win);
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const mv = (m: PointerEvent) => {
      if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 3) return;
      moved = true;
      place(win, l0 + (m.clientX - sx) / s, t0 + (m.clientY - sy) / s);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (moved) { const [x, y] = localPos(win); save(winId(win), x, y); }
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    e.preventDefault();
  });
}

/** Подключает все окна корня (и появляющиеся позже). name — имя персонажа для ключа localStorage. */
export function initWindowDrag(root: HTMLElement, nameFn: () => string) {
  getName = nameFn;
  const hook = (n: Node) => { if (n instanceof HTMLElement && n.classList.contains("win")) makeDraggable(n); };
  root.querySelectorAll<HTMLElement>(".win").forEach(hook);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach(hook);
      else if (m.target instanceof HTMLElement && m.target.classList.contains("win") && !m.target.hidden) { makeDraggable(m.target); restore(m.target); }
    }
  }).observe(root, { childList: true, subtree: false });
  // hidden-атрибут следим на самих окнах
  const obs = new MutationObserver((muts) => { for (const m of muts) { const w = m.target as HTMLElement; if (!w.hidden) requestAnimationFrame(() => restore(w)); } });
  const watch = (w: HTMLElement) => obs.observe(w, { attributes: true, attributeFilter: ["hidden"] });
  root.querySelectorAll<HTMLElement>(".win").forEach(watch);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => n instanceof HTMLElement && n.classList.contains("win") && watch(n)))).observe(root, { childList: true });
  window.addEventListener("resize", () => known.forEach((w) => { if (w.dataset.moved && !w.hidden) place(w, ...localPos(w)); }));
}

export function resetWindowPositions() {
  try { localStorage.removeItem(key()); } catch {}
  known.forEach((w) => { const st = w.style; st.left = st.top = st.right = st.bottom = st.transform = ""; delete w.dataset.moved; });
}
