import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { diamond, ISO, isoLayout, pointInPrism, prismSilhouette, projectIso, terrainOccludesActor, unprojectIso, sampleMotion, viewPoint, type Rotation } from '../../lib/demoGame/isometric';
import { distance, isGround, isPlaced, keyOf, samePoint, sceneOf, scenePoints, tileAt } from '../../lib/demoGame/map';
import { spriteFor } from '../../lib/demoGame/sprites';
import type { Combatant, GameEvent, GameWorld, Point } from '../../lib/demoGame/types';
import CharacterSprite from './CharacterSprite';
import type { BoardTool } from './GameBoard';
import type { SpriteAnimation } from '../../types/sprites';

interface Props {
  world: GameWorld;
  selected?: Combatant;
  isDm: boolean;
  tool: BoardTool;
  path: Point[];
  range?: number;
  targeting: boolean;
  zoom: number;
  rotation: Rotation;
  cutaway: boolean;
  resetView?: number;
  area?: Point[];
  onAimHover?: (point: Point) => void;
  event?: GameEvent;
  onTile: (point: Point) => void;
  onActor: (id: string) => void;
}

// This is a visual replay of committed steps, never a second simulation of movement/AP.
function useMotion(event: GameEvent | undefined, world: GameWorld, isDm: boolean) {
  const seen = useRef(event?.id);
  const [motion, setMotion] = useState<{ id: string; point: Point; from: Point; to: Point; t: number } | null>(null);
  useEffect(() => {
    setMotion(null);
    if (seen.current === event?.id) return;
    seen.current = event?.id;
    const trace = event?.motion;
    if (!trace || trace.sceneId !== world.sceneId || trace.path.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!isDm && trace.path.some(p => tileAt(sceneOf(world), p).hidden)) return;
    const actor = world.actors.find(a => a.id === trace.actorId), end = trace.path[trace.path.length - 1];
    if (!actor || actor.position.x !== end.x || actor.position.y !== end.y) return;
    const duration = Math.min(280, 3000 / (trace.path.length - 1));
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // A frame's timestamp can precede performance.now() from the current task.
      const progress = Math.max(0, (now - start) / duration), index = Math.floor(progress);
      if (index >= trace.path.length - 1) { setMotion(null); return; }
      setMotion({ id: trace.actorId, point: sampleMotion(trace.path, progress), from: trace.path[index], to: trace.path[index + 1], t: progress - index });
      frame = requestAnimationFrame(tick);
    };
    tick(start);
    return () => cancelAnimationFrame(frame);
  }, [event?.id, world.sceneId, isDm]);
  return motion;
}

export default function IsometricBoard({ world, selected, isDm, tool, path, range, targeting, zoom, rotation, cutaway, resetView, area = [], event, onTile, onActor, onAimHover }: Props) {
  const seenAnimation = useRef(event?.id);
  const [animations, setAnimations] = useState<Record<string, SpriteAnimation>>({});
  useEffect(() => {
    setAnimations({});
    if (seenAnimation.current === event?.id) return;
    seenAnimation.current = event?.id;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const entry of event?.animations || []) {
      const actor = world.actors.find(a => a.id === entry.actorId);
      if (!actor || !isPlaced(actor) || (!isDm && (actor.hidden || tileAt(sceneOf(world), actor.position).hidden))) continue;
      const clip = actor.character.sprites?.clips[entry.animation];
      const duration = clip ? clip.frames / clip.fps * 1000 : 800;
      timers.push(setTimeout(() => setAnimations(current => ({ ...current, [entry.actorId]: entry.animation })), entry.delay));
      timers.push(setTimeout(() => setAnimations(current => {
        if (current[entry.actorId] !== entry.animation) return current;
        const next = { ...current }; delete next[entry.actorId]; return next;
      }), entry.delay + duration));
    }
    return () => timers.forEach(clearTimeout);
  }, [event?.id, world.sceneId, isDm]);
  const scene = sceneOf(world), layout = isoLayout(scene, rotation), motion = useMotion(event, world, isDm);
  const maskPrefix = useId().replace(/:/g, '');
  const [hover, setHover] = useState<Point | null>(null);
  const [hoverActor, setHoverActor] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; pan: Point; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [aspect, setAspect] = useState(1.8);
  const [home] = useState({ center: { x: (scene.minX || 0) + (scene.width - 1) / 2, y: (scene.minY || 0) + (scene.height - 1) / 2 }, width: Math.min(layout.width, 2400), height: Math.min(layout.height, 1400) });
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [resetView]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.height) setAspect(entry.contentRect.width / entry.contentRect.height); });
    if (svgRef.current) observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);
  const span = Math.max(home.width, home.height * aspect) / zoom, viewHeight = span / aspect;
  const center = projectIso(home.center, 0, scene, rotation, layout);
  const viewX = center.x - span / 2 + pan.x, viewY = center.y - viewHeight / 2 + pan.y;
  const areaKeys = new Set(area.map(keyOf));
  const pathKeys = useMemo(() => new Set(path.map(keyOf)), [path]);
  const visibleActors = world.actors.filter(a => isPlaced(a) && (isDm || (!a.hidden && !tileAt(scene, a.position).hidden)));
  const tiles = useMemo(() => scenePoints(scene).filter(p => tileAt(scene, p).terrain !== 'void').map(p => {
    const v = viewPoint(p, scene, rotation);
    return { p, depth: v.x + v.y, tile: tileAt(scene, p) };
  }), [scene, rotation]);
  const actors = visibleActors.map(actor => {
    const walking = motion?.id === actor.id ? motion : null, p = walking?.point || actor.position;
    const elevation = walking ? tileAt(scene, walking.from).elevation * (1 - walking.t) + tileAt(scene, walking.to).elevation * walking.t : tileAt(scene, p).elevation;
    const v = viewPoint(p, scene, rotation), screen = projectIso(p, elevation, scene, rotation, layout);
    const facing = walking ? Math.sign(projectIso(walking.to, 0, scene, rotation, layout).x - projectIso(walking.from, 0, scene, rotation, layout).x) || 1 : 1;
    return { actor, p, v, elevation, depth: v.x + v.y + .1, screen, walking, facing };
  });
  const geometry = (entry: typeof tiles[number]) => {
    const { p, tile } = entry, fogged = tile.hidden && !isDm;
    const screen = projectIso(p, fogged ? 0 : tile.elevation, scene, rotation, layout);
    const v = viewPoint(p, scene, rotation), vw = rotation % 2 ? scene.height : scene.width, vh = rotation % 2 ? scene.width : scene.height;
    const foreground = v.x === vw - 1 || v.y === vh - 1;
    const obstructs = actors.some(a => Math.abs(screen.x - a.screen.x) < 65 && screen.y > a.screen.y && screen.y - a.screen.y < 84);
    const wall = !fogged && tile.terrain === 'wall', wallHeight = wall ? cutaway && (foreground || obstructs) ? 10 : ISO.level * 2 : 0;
    return { ...screen, v, fogged, wall, wallHeight, top: screen.y - wallHeight, bottom: screen.y + (fogged ? 0 : tile.elevation * ISO.level) + 10, topElevation: (fogged ? 0 : tile.elevation) + wallHeight / ISO.level };
  };
  const renderedTiles = tiles.map(entry => ({ ...entry, geometry: geometry(entry) })).sort((a, b) => a.depth - b.depth);
  // Terrain is ordered as vertical prisms; sprites are composited afterwards with
  // masks from only foreground prisms above their feet. Flat floor never clips a
  // walking sprite, while high terrain and walls can correctly occlude it.
  const objects = [...renderedTiles.map(tile => ({ tile })), ...actors.sort((a, b) => a.depth - b.depth).map(actor => ({ actor }))];
  const occluderAt = (clientX: number, clientY: number, actor: typeof actors[number]) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return undefined;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [...renderedTiles].reverse().find(t => terrainOccludesActor(t.geometry.v, t.geometry.topElevation, actor.v, actor.elevation) && pointInPrism(point, t.geometry));
  };
  const placing = isDm && selected && !isPlaced(selected) && tool === 'move';
  const paintPreview = isDm && ['floor', 'wall', 'difficult', 'void', 'raise', 'lower'].includes(tool);
  const previewTile = hover ? tileAt(scene, hover) : undefined;
  const occupiedPreview = Boolean(hover && world.actors.some(a => isPlaced(a) && samePoint(a.position, hover)));
  const previewValid = placing ? Boolean(hover && isGround(previewTile!) && !occupiedPreview) : !(['wall', 'void'].includes(tool) && occupiedPreview);
  const previewPoint = hover ? projectIso(hover, previewTile?.terrain === 'void' ? 0 : previewTile?.elevation || 0, scene, rotation, layout) : null;
  return <div className="dg-board-scroll dg-iso-scroll">
    <div className={`dg-board dg-isometric ${tool === 'pan' ? 'is-panning' : ''}`}>
      <svg ref={svgRef} className="dg-map dg-iso-map" viewBox={`${viewX} ${viewY} ${span} ${viewHeight}`} role="group" aria-label="Battle map" onMouseLeave={() => setHover(null)}
        onPointerDown={e => { if (tool === 'pan' || e.button === 1 || e.altKey) { e.preventDefault(); dragged.current = false; drag.current = { x: e.clientX, y: e.clientY, pan, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); } }}
        onPointerMove={e => { if (!drag.current) { const matrix = e.currentTarget.getScreenCTM(); if (matrix && (e.target === e.currentTarget || (e.target as Element).classList.contains('dg-empty-plane'))) { const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()); const cell = unprojectIso(point, scene, rotation, layout); setHover(cell); if (targeting) onAimHover?.(cell); } return; } const scale = span / e.currentTarget.getBoundingClientRect().width; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true; setPan({ x: drag.current.pan.x - dx * scale, y: drag.current.pan.y - dy * scale }); }}
        onPointerUp={e => { dragged.current = Boolean(drag.current?.moved); drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { drag.current = null; dragged.current = true; }}
        onClickCapture={e => { if (dragged.current || tool === 'pan') { e.preventDefault(); e.stopPropagation(); dragged.current = false; } }}
        onClick={e => { if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('dg-empty-plane')) return; const matrix = e.currentTarget.getScreenCTM(); if (!matrix) return; const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()); onTile(unprojectIso(p, scene, rotation, layout)); }}>
        <defs><pattern id="dg-empty-grid" width="96" height="48" patternUnits="userSpaceOnUse" x={layout.origin.x} y={layout.origin.y + ISO.halfHeight}><path d="M0 0L96 48M96 0L0 48" fill="none" stroke="#3e5055" strokeWidth=".7" /></pattern></defs>
        <defs>{actors.map(actor => <mask id={`${maskPrefix}-${actor.actor.id}`} key={actor.actor.id} maskUnits="userSpaceOnUse" x={viewX} y={viewY} width={span} height={viewHeight} style={{ maskType: 'luminance' }}>
          <rect x={viewX} y={viewY} width={span} height={viewHeight} fill="white" />
          {renderedTiles.filter(t => terrainOccludesActor(t.geometry.v, t.geometry.topElevation, actor.v, actor.elevation)).map(t => <polygon key={keyOf(t.p)} data-occluder={keyOf(t.p)} points={prismSilhouette(t.geometry.x, t.geometry.top, t.geometry.bottom)} fill="black" />)}
        </mask>)}</defs>
        <rect className="dg-empty-plane" x={viewX} y={viewY} width={span} height={viewHeight} fill="url(#dg-empty-grid)" />
        {scene.background && <image href={scene.background} width={layout.width} height={layout.height} opacity=".2" preserveAspectRatio="xMidYMid slice" pointerEvents="none" />}
        <path d={`M${layout.origin.x} ${layout.origin.y - 12}l${scene.width * 48} ${scene.width * 24}l${-scene.height * 48} ${scene.height * 24}l${-scene.width * 48} ${-scene.width * 24}Z`} fill="#080c0c" opacity=".8" transform="translate(0 20)" pointerEvents="none" />
        {objects.map(object => {
          if ('tile' in object) {
            const { p, tile, geometry: { x, y, fogged, wall, wallHeight, top, bottom } } = object.tile;
            const activePath = pathKeys.has(keyOf(p)), inRange = selected && range !== undefined && distance(selected.position, p) <= range;
            const fill = fogged ? '#171d22' : tile.terrain === 'difficult' ? '#72634c' : wall ? '#aaa59a' : (p.x * 7 + p.y * 11) % 4 === 0 ? '#59636a' : '#4e575c';
            return <g key={`tile-${keyOf(p)}`} data-depth={object.tile.depth} data-x={p.x} data-y={p.y} className={`dg-iso-cell ${wall ? 'is-wall' : ''}`} onMouseEnter={() => { setHover(p); if (targeting) onAimHover?.(p); }} onClick={e => { e.stopPropagation(); onTile(p); }}>
              <g pointerEvents="visiblePainted">
                {wall && <polygon className="dg-wall-footprint" points={diamond(x, y)} fill="#4e575c" stroke="#778676" strokeWidth=".8" />}
                <polygon points={`${x - 48},${top} ${x},${top + 24} ${x},${bottom + 24} ${x - 48},${bottom}`} fill={wall ? '#52584f' : '#29352e'} stroke="#202b26" strokeWidth="1" />
                <polygon points={`${x},${top + 24} ${x + 48},${top} ${x + 48},${bottom} ${x},${bottom + 24}`} fill={wall ? '#676e60' : '#344338'} stroke="#202b26" strokeWidth="1" />
                {wallHeight > 20 && <path d={`M${x - 47} ${top + 17}l47 24 47 -24 M${x - 22} ${top + 13}v16 M${x + 24} ${top + 29}v16`} fill="none" stroke="#323c34" strokeWidth="2" />}
              </g>
              <polygon className="dg-tile" data-x={p.x} data-y={p.y} points={diamond(x, top)} fill={fill} stroke="#778676" strokeWidth=".8"
                role="button" tabIndex={hover?.x === p.x && hover?.y === p.y ? 0 : -1} aria-label={`Tile ${p.x}, ${p.y}`}
                onMouseEnter={() => { setHover(p); if (targeting) onAimHover?.(p); }} onClick={e => { e.stopPropagation(); onTile(p); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTile(p); } }}>
                <title>{`${p.x}, ${p.y} / ${fogged ? 'Hidden' : `${tile.terrain} / height ${tile.elevation}`}`}</title>
              </polygon>
              <g pointerEvents="none">
                {!fogged && !wall && <path d={`M${x - 33} ${top - 4}l14 -7 8 2 M${x + 22} ${top + 6}l-8 4`} fill="none" stroke="#879083" opacity=".25" />}
                {!fogged && tile.terrain === 'difficult' && <g fill="#a39874" stroke="#4b4939" strokeWidth="2"><path d={`M${x - 27} ${y}l12 -7 10 9 -13 6Z M${x + 10} ${y + 2}l11 -5 9 5 -12 7Z`} /></g>}
                {inRange && !fogged && !wall && <polygon points={diamond(x, top, 2)} fill="#e8c77a" opacity=".2" />}
                {areaKeys.has(keyOf(p)) && !fogged && <polygon className="dg-area-tile" points={diamond(x, top, 2)} fill="#e67c98" fillOpacity=".35" stroke="#ffd0dd" strokeWidth="2" />}
                {activePath && !fogged && <polygon points={diamond(x, top, 3)} fill="#9df2ca" fillOpacity=".3" stroke="#b4f7d7" strokeWidth="2" />}
                {path.length > 1 && path.slice(1).map((step, index) => {
                  if (step.x !== p.x || step.y !== p.y || fogged) return null;
                  return <g key={index}><circle cx={x} cy={y} r="10" fill="#1c4031" /><text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="#d4ffe5">{index + 1}</text></g>;
                })}
                {tile.hidden && isDm && <polygon points={diamond(x, top)} fill="#161622" opacity=".65" />}
                {tile.elevation > 0 && !fogged && <text x={x} y={top + 15} textAnchor="middle" fontSize="10" fill="#eee2b7">+{tile.elevation}</text>}
                {hover?.x === p.x && hover?.y === p.y && <polygon points={diamond(x, top, 1)} fill="#e6f0c6" fillOpacity=".15" stroke="#eaf2d0" strokeWidth="2" />}
              </g>
            </g>;
          }
          const { actor, screen, walking, facing } = object.actor;
          const color = actor.team === 'party' ? '#8aebc6' : actor.team === 'opposition' ? '#fa879e' : '#e8ce8c';
          const selectedActor = selected?.id === actor.id;
          return <g key={actor.id} mask={`url(#${maskPrefix}-${actor.id})`}><g transform={`translate(${screen.x} ${screen.y})`} className="dg-token dg-iso-token" role="button" tabIndex={0} aria-label={`Select ${actor.character.name}`}
            data-position={`${screen.x},${screen.y}`} opacity={actor.hidden ? .5 : 1}
            onMouseMove={e => { const tile = occluderAt(e.clientX, e.clientY, object.actor); const point = tile?.p || actor.position; setHoverActor(tile ? null : actor.id); setHover(point); if (targeting) onAimHover?.(point); }} onMouseLeave={() => setHoverActor(null)} onFocus={() => setHoverActor(actor.id)} onBlur={() => setHoverActor(null)}
            onClick={e => { e.stopPropagation(); const tile = occluderAt(e.clientX, e.clientY, object.actor); if (tile) onTile(tile.p); else onActor(actor.id); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActor(actor.id); } }}>
            <title>{actor.character.name}{world.combat.activeId === actor.id ? ' / Current turn' : ''}</title>
            <ellipse cy="3" rx="28" ry="12" fill="#0c1711" opacity=".65" />
            <ellipse rx="31" ry="14" fill={color} fillOpacity={selectedActor ? '.23' : '.08'} stroke={selectedActor ? '#fff3c8' : color} strokeWidth={selectedActor ? 3 : 2} />
            {world.combat.running && world.combat.activeId === actor.id && <ellipse rx="37" ry="18" stroke="#f8d889" strokeWidth="2" strokeDasharray="5 4" fill="none" />}
            <CharacterSprite preset={spriteFor(actor)} profile={actor.character.sprites} animation={animations[actor.id]} moving={Boolean(walking)} facing={facing} inactive={actor.state !== 'active'} />
            <rect className="dg-token-hit" x="-31" y="-82" width="62" height="98" fill="transparent" />
            {actor.state !== 'active' && <text x="0" y="-25" textAnchor="middle" fill="#fff" stroke="#4b2230" strokeWidth="4" paintOrder="stroke" fontSize="22">X</text>}
          </g></g>;
        })}
        {hover && previewPoint && (paintPreview || placing) && <g className="dg-placement-preview" data-x={hover.x} data-y={hover.y} data-valid={previewValid} pointerEvents="none">
          <polygon points={diamond(previewPoint.x, previewPoint.y)} fill={previewValid ? '#90edbe' : '#fa718e'} fillOpacity=".32" stroke={previewValid ? '#c4ffe2' : '#ffb8c7'} strokeWidth="2.5" />
          {tool === 'wall' && <polygon points={prismSilhouette(previewPoint.x, previewPoint.y - ISO.level * 2, previewPoint.y)} fill="#dae7dd" fillOpacity=".28" stroke="#d7ffe7" strokeWidth="1.5" />}
          {placing && <g transform={`translate(${previewPoint.x} ${previewPoint.y})`} opacity=".55"><CharacterSprite preset={spriteFor(selected)} profile={selected.character.sprites} moving={false} facing={1} inactive={false} /></g>}
          <text x={previewPoint.x} y={previewPoint.y + 40} textAnchor="middle" fill="#fff" stroke="#172821" strokeWidth="4" paintOrder="stroke" fontSize="13">{hover.x}, {hover.y}</text>
        </g>}
        <g pointerEvents="none">{actors.filter(a => a.actor.id === selected?.id || a.actor.id === hoverActor).map(({ actor, screen }) => <text key={actor.id} x={screen.x} y={screen.y + 31} textAnchor="middle" fill="#f1f0df" stroke="#14221b" strokeWidth="5" paintOrder="stroke" fontSize="13" fontWeight="600">{actor.character.name.length > 32 ? `${actor.character.name.slice(0, 31)}...` : actor.character.name}</text>)}</g>
      </svg>
      <div className="dg-map-caption"><span>{scene.name}</span><span>{targeting ? 'Select target' : hover ? `${hover.x}, ${hover.y}` : tool === 'move' ? 'Isometric' : tool}</span></div>
    </div>
  </div>;
}
