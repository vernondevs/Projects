/** Простой общий цикл дня и ночи по часам: у всех клиентов совпадает. */
export const DAY_CYCLE_MS = 20 * 60 * 1000;

/** Степень ночи 0..1 (0 — день; плавные сумерки). Ночь занимает последнюю часть цикла. */
export function nightLevel(ms: number): number {
  const p = (((ms % DAY_CYCLE_MS) + DAY_CYCLE_MS) % DAY_CYCLE_MS) / DAY_CYCLE_MS;
  // 0..0.62 день, 0.62..0.72 закат, 0.72..0.92 ночь, 0.92..1 рассвет
  if (p < 0.62) return 0;
  if (p < 0.72) return (p - 0.62) / 0.1;
  if (p < 0.92) return 1;
  return 1 - (p - 0.92) / 0.08;
}
