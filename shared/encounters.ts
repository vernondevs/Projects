/** Сообщения случайных встреч (сервер -> клиент). */
import type { Item } from "./items";

export interface EncNpcMsg { id: string; name: string; sprite: string; tint: number; color: string; icon: string; lying: boolean; x: number; y: number }
export interface EncDialogMsg { id: string; name: string; text: string; opts: { id: string; label: string }[] }
export interface EncShopMsg { id: string; name: string; text: string; until: number; stock: { idx: number; item: Item; price: number }[] }
