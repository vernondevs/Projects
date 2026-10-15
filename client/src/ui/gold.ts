/** Золото в интерфейсе: число с разделителями + иконка монеты (1em). */
export const formatNumber = (n: number): string => Math.round(n).toLocaleString("ru-RU").replace(/ | /g, " ");
export const gold = (n: number, pre = ""): string => `<span class="gold-amt">${pre}${formatNumber(n)}<img class="coin" src="/assets/icons/coin.png" alt="золото"></span>`;
/** Заменяет в готовом HTML-тексте «N з» / «N золота» на число с монетой. */
export const goldify = (html: string): string => html.replace(/(\d[\d ]*)\s?(?:золота|золото|з)(?![\p{L}])/gu, (_m, n: string) => gold(Number(n.replace(/ /g, ""))));
