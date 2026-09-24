import { useId, useState } from 'react';
import type { Combatant, GameEvent, GameWorld, Point } from '../../lib/demoGame/types';
import type { Rotation } from '../../lib/demoGame/isometric';
import IsometricBoard from './IsometricBoard';
import { actorImage } from '../../lib/demoGame/adapter';
import { isPlaced, sceneOf } from '../../lib/demoGame/map';

export type BoardTool = 'move' | 'pan' | 'teleport' | 'floor' | 'wall' | 'difficult' | 'void' | 'raise' | 'lower' | 'hide' | 'reveal';
interface Props {
  world: GameWorld;
  selected: Combatant | undefined;
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
  onTile: (position: Point) => void;
  onActor: (id: string) => void;
  onRoleplayMove: (position: Point) => void;
}

export function TokenImage({ actor }: { actor: Combatant }) {
  const [failed, setFailed] = useState(false);
  const url = actorImage(actor);
  return url && !failed ? <img src={url} alt="" draggable={false} onError={() => setFailed(true)} referrerPolicy="no-referrer" /> : <span>{actor.character.name.slice(0, 2).toUpperCase()}</span>;
}

export default function GameBoard(props: Props) {
  return props.world.mode === 'battle' ? <IsometricBoard key={props.world.sceneId} {...props} /> : <RoleplayBoard {...props} />;
}

function RoleplayBoard({ world, selected, isDm, zoom, onActor, onRoleplayMove }: Props) {
  const scene = sceneOf(world), size = 64, svgId = useId().replace(/:/g, '');
  const width = scene.width * size, height = scene.height * size;
  return <div className="dg-board-scroll">
    <div className="dg-board is-roleplay" style={{ width: `${zoom * 100}%`, maxWidth: `${690 * scene.width / scene.height * zoom}px`, aspectRatio: `${scene.width} / ${scene.height}` }}>
      {scene.background && <img className="dg-background" src={scene.background} alt={scene.name} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} key={scene.background} />}
      <svg className="dg-map" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Roleplay scene"
        onClick={event => {
          if (selected) {
            const rect = event.currentTarget.getBoundingClientRect();
            onRoleplayMove({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
          }
        }}>
        <defs>
          <pattern id={`${svgId}-stone`} width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="#343b38" /><path d="M0 0H64V64H0Z M4 4H60V60H4Z" fill="none" stroke="#46504a" strokeWidth="1" /><path d="M6 15L22 11M47 48L58 52M16 57L22 52" stroke="#535b51" opacity=".4" /></pattern>
        </defs>
        {!scene.background && <rect width={width} height={height} fill={`url(#${svgId}-stone)`} opacity=".35" />}
        {world.actors.filter(a => isPlaced(a) && (isDm || !a.hidden)).map(actor => {
          const point = { x: actor.roleplayPosition.x * width, y: actor.roleplayPosition.y * height };
          const radius = 42, color = actor.team === 'party' ? '#75dbb7' : actor.team === 'opposition' ? '#ed8094' : '#e5cc88';
          const clipId = `${svgId}-${actor.id}`;
          return <g key={actor.id} transform={`translate(${point.x} ${point.y})`} className="dg-token" role="button" tabIndex={0} aria-label={`Select ${actor.character.name}`}
            opacity={actor.hidden ? .5 : 1} onClick={event => { event.stopPropagation(); onActor(actor.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActor(actor.id); } }}>
            <title>{actor.character.name}{world.combat.activeId === actor.id ? ' / Current turn' : ''}</title>
            <defs><clipPath id={clipId}><circle r={radius - 3} /></clipPath></defs>
            {world.combat.running && world.combat.activeId === actor.id && <circle r={radius + 7} stroke="#f5d78b" strokeWidth="2" fill="none" strokeDasharray="4 3" />}
            <circle r={radius} fill="#242c29" stroke={selected?.id === actor.id ? '#fff4d6' : color} strokeWidth={selected?.id === actor.id ? 4 : 2} />
            <text textAnchor="middle" y="5" fill={color} fontSize="15" fontWeight="700">{actor.character.name.slice(0, 2).toUpperCase()}</text>
            {actorImage(actor) && <image href={actorImage(actor)} x={-radius + 3} y={-radius + 3} width={(radius - 3) * 2} height={(radius - 3) * 2} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" />}
            {actor.state !== 'active' && <path d={`M-${radius / 2} -${radius / 2}L${radius / 2} ${radius / 2}M-${radius / 2} ${radius / 2}L${radius / 2} -${radius / 2}`} stroke="#fff" strokeWidth="4" />}
            <text textAnchor="middle" y={radius + 24} fill="#fff8e6" stroke="#181d19" strokeWidth="4" paintOrder="stroke" fontSize="17">{actor.character.name}</text>
          </g>;
        })}
      </svg>
      <div className="dg-map-caption"><span>{scene.name}</span><span>Roleplay</span></div>
    </div>
  </div>;
}
