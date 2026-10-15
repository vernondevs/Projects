/** Биомы: параметры окружения и ресурсы из /data/biomes.json (сервер и клиент считают одинаково). */
import data from "../data/biomes.json";

export const ENV = data.env;
export interface Resource {
  id: string;
  name: string;
  price: number;
  /** Вид объекта на карте (узел добычи). */
  node: string;
  zone: string;
  color: string;
  /** Иконка предмета. */
  icon: string;
}
export const RESOURCES: Record<string, Resource> = Object.fromEntries(
  Object.entries(data.resources).map(([id, r]) => [id, { ...r, id, icon: `res_${id}` }]),
);
export const RESOURCE_IDS = Object.keys(RESOURCES);
/** Ресурс по виду узла (node_cactus → cactus_juice). */
export const resourceOfNode = (kind: string): Resource | undefined => RESOURCE_IDS.map((i) => RESOURCES[i]).find((r) => r.node === kind);

/** Узел добычи на карте: id — индекс в map.objects. */
export interface MapNode {
  id: number;
  kind: string;
  res: string;
  x: number;
  y: number;
}
