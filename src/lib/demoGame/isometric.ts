import type { Point, Scene } from './types';

export const ISO = { halfWidth: 48, halfHeight: 24, level: 18, margin: 48 };
export type Rotation = 0 | 1 | 2 | 3;

export function viewPoint(position: Point, scene: Pick<Scene, 'width' | 'height' | 'minX' | 'minY'>, rotation: Rotation): Point {
  const point = { x: position.x - (scene.minX || 0), y: position.y - (scene.minY || 0) };
  switch (rotation) {
    case 1: return { x: point.y, y: scene.width - 1 - point.x };
    case 2: return { x: scene.width - 1 - point.x, y: scene.height - 1 - point.y };
    case 3: return { x: scene.height - 1 - point.y, y: point.x };
    default: return point;
  }
}

export function unprojectIso(screen: Point, scene: Scene, rotation: Rotation, layout = isoLayout(scene, rotation)): Point {
  const { origin } = layout;
  const dx = (screen.x - origin.x) / ISO.halfWidth, dy = (screen.y - origin.y) / ISO.halfHeight;
  const x = Math.round((dx + dy) / 2), y = Math.round((dy - dx) / 2);
  const p = rotation === 1 ? { x: scene.width - 1 - y, y: x } : rotation === 2 ? { x: scene.width - 1 - x, y: scene.height - 1 - y } : rotation === 3 ? { x: y, y: scene.height - 1 - x } : { x, y };
  return { x: p.x + (scene.minX || 0), y: p.y + (scene.minY || 0) };
}

export function isoLayout(scene: Scene, rotation: Rotation) {
  const rows = rotation % 2 ? scene.width : scene.height;
  const top = 106 + Object.values(scene.tiles).reduce((max, t) => Math.max(max, t.elevation), 0) * ISO.level;
  return { width: (scene.width + scene.height) * ISO.halfWidth + ISO.margin * 2,
    height: (scene.width + scene.height) * ISO.halfHeight + top + 64,
    origin: { x: rows * ISO.halfWidth + ISO.margin, y: top } };
}

export function projectIso(point: Point, elevation: number, scene: Scene, rotation: Rotation, layout = isoLayout(scene, rotation)): Point {
  const p = viewPoint(point, scene, rotation), { origin } = layout;
  return { x: origin.x + (p.x - p.y) * ISO.halfWidth, y: origin.y + (p.x + p.y) * ISO.halfHeight - elevation * ISO.level };
}

export const diamond = (x: number, y: number, inset = 0) =>
  `${x},${y - ISO.halfHeight + inset} ${x + ISO.halfWidth - inset * 2},${y} ${x},${y + ISO.halfHeight - inset} ${x - ISO.halfWidth + inset * 2},${y}`;

// A tile is a vertical prism on one grid footprint, including its elevated base.
export function prismSilhouette(x: number, top: number, bottom: number) {
  return `${x},${top - 24} ${x + 48},${top} ${x + 48},${bottom} ${x},${bottom + 24} ${x - 48},${bottom} ${x - 48},${top}`;
}

export function pointInPrism(point: Point, prism: { x: number; top: number; bottom: number }) {
  const dx = Math.abs(point.x - prism.x);
  return dx <= 48 && point.y >= prism.top - 24 + dx / 2 && point.y <= prism.bottom + 24 - dx / 2;
}

export function terrainOccludesActor(tileView: Point, topElevation: number, actorView: Point, feetElevation: number) {
  if (topElevation <= feetElevation + .001) return false;
  // Camera rays travel toward increasing view X/Y. The supporting tile must not
  // hide its own actor, including a sprite interpolating across its boundary.
  const dx = tileView.x - actorView.x, dy = tileView.y - actorView.y;
  return dx > -.5 && dy > -.5 && (dx >= .5 || dy >= .5);
}

export function sampleMotion(path: Point[], progress: number): Point {
  const step = Math.max(0, Math.min(path.length - 1, progress));
  const index = Math.floor(step), a = path[index], b = path[Math.min(index + 1, path.length - 1)], t = step - index;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
