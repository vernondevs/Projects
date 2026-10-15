/** Подписи над юнитами: ники и полоски здоровья — отдельно для своего героя и для остальных. Хранится в localStorage. */
export type OverlayKey = "selfNames" | "selfBars" | "names" | "bars";
const STORE: Record<OverlayKey, string> = { selfNames: "showSelfNames", selfBars: "showSelfBars", names: "showNames", bars: "showBars" };
function load(key: string): boolean {
  try { return localStorage.getItem(key) !== "0"; } catch { return true; }
}
export const overlay: Record<OverlayKey, boolean> = {
  selfNames: load(STORE.selfNames), selfBars: load(STORE.selfBars), names: load(STORE.names), bars: load(STORE.bars),
};
export function setOverlay(key: OverlayKey, on: boolean) {
  overlay[key] = on;
  try { localStorage.setItem(STORE[key], on ? "1" : "0"); } catch {}
}
