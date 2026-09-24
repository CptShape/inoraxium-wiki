import createGraph from 'ngraph.graph';
import { aStar } from 'ngraph.path';
import type { Combatant, GameWorld, Point, Scene, Tile } from './types';

export const keyOf = (p: Point) => `${p.x},${p.y}`;
export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const isPlaced = (actor: Combatant) => actor.placed !== false;
export const sceneOf = (world: GameWorld) => world.scenes.find(s => s.id === world.sceneId)!;
export const tileAt = (scene: Scene, point: Point): Tile => scene.tiles[keyOf(point)] || { terrain: scene.sparse || !inside(scene, point) ? 'void' : 'floor', elevation: 0, hidden: false };
export const inside = (scene: Scene, p: Point) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= (scene.minX || 0) && p.y >= (scene.minY || 0) && p.x < (scene.minX || 0) + scene.width && p.y < (scene.minY || 0) + scene.height;
export const isGround = (tile: Tile) => tile.terrain === 'floor' || tile.terrain === 'difficult';
export function scenePoints(scene: Scene): Point[] {
  if (scene.sparse) return Object.keys(scene.tiles).filter(k => scene.tiles[k].terrain !== 'void').map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
  return Array.from({ length: scene.width * scene.height }, (_, i) => ({ x: (scene.minX || 0) + i % scene.width, y: (scene.minY || 0) + Math.floor(i / scene.width) }));
}
export function materializeScene(scene: Scene) {
  if (scene.sparse) return;
  for (const p of scenePoints(scene)) scene.tiles[keyOf(p)] = tileAt(scene, p);
  scene.sparse = true;
}
export function includePoint(scene: Scene, p: Point) {
  if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y) || Math.abs(p.x) > 1000000 || Math.abs(p.y) > 1000000) throw new Error('Invalid map coordinate.');
  const x = Math.min(scene.minX || 0, p.x), y = Math.min(scene.minY || 0, p.y);
  scene.width = Math.max((scene.minX || 0) + scene.width, p.x + 1) - x;
  scene.height = Math.max((scene.minY || 0) + scene.height, p.y + 1) - y;
  scene.minX = x; scene.minY = y;
}
export const distance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function traverse(world: GameWorld, actor: Combatant, from: Point, to: Point): { allowed: boolean; cost: number } {
  const scene = sceneOf(world);
  const target = tileAt(scene, to);
  const origin = tileAt(scene, from);
  const dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
  const clear = (p: Point) => inside(scene, p) && isGround(tileAt(scene, p)) && !world.actors.some(a => isPlaced(a) && a.id !== actor.id && samePoint(a.position, p));
  if (!inside(scene, from) || !clear(to) || Math.max(dx, dy) !== 1 || Math.abs(target.elevation - origin.elevation) > world.rules.maxStepHeight) return { allowed: false, cost: 0 };
  if (dx && dy && (!clear({ x: from.x, y: to.y }) || !clear({ x: to.x, y: from.y }))) return { allowed: false, cost: 0 };
  return {
    allowed: true,
    cost: (dx && dy ? world.rules.diagonalCost : world.rules.orthogonalCost) * (target.terrain === 'difficult' ? 2 : 1)
      + Math.max(0, target.elevation - origin.elevation) * world.rules.elevationCost,
  };
}

export function findMovement(world: GameWorld, actor: Combatant, destination: Point) {
  const scene = sceneOf(world);
  if (!isPlaced(actor) || !inside(scene, actor.position) || !isGround(tileAt(scene, actor.position)) || !inside(scene, destination) || !isGround(tileAt(scene, destination))) return { path: [] as Point[], cost: 0 };
  if (samePoint(actor.position, destination)) return { path: [actor.position], cost: 0 };
  const graph = createGraph<Point, number>();
  for (const p of scenePoints(scene)) if (isGround(tileAt(scene, p))) graph.addNode(keyOf(p), p);
  graph.forEachNode(node => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const to = { x: node.data.x + dx, y: node.data.y + dy };
      const evaluation = traverse(world, actor, node.data, to);
      if (evaluation.allowed) graph.addLink(node.id, keyOf(to), evaluation.cost);
    }
  });
  // Zero heuristic is intentional: custom diagonal/elevation costs remain optimal.
  const path = aStar(graph, { oriented: true, heuristic: () => 0, distance: (_a, _b, link) => link.data }).find(keyOf(actor.position), keyOf(destination)).map(n => n.data).reverse();
  return { path, cost: path.slice(1).reduce((sum, point, index) => sum + traverse(world, actor, path[index], point).cost, 0) };
}

export function hasLineOfSight(world: GameWorld, from: Point, to: Point) {
  const scene = sceneOf(world);
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 4;
  const startHeight = tileAt(scene, from).elevation + 1;
  const endHeight = tileAt(scene, to).elevation + 1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
    const tile = tileAt(scene, p);
    if (!samePoint(p, from) && !samePoint(p, to) && tile.elevation + (tile.terrain === 'wall' ? 2 : 0) >= startHeight + (endHeight - startHeight) * t) return false;
  }
  return true;
}
