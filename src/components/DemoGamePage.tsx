import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, CircleHelp, Download, Eye, EyeOff, Footprints, Grid2X2, Hand, Heart, Hourglass, Minus, Mountain, Move, Play, Plus, RotateCcw, RotateCw, Scan, PanelBottomClose, Settings2, Shield, Swords, Trash2, UserMinus, Undo2, Users, WandSparkles, X } from 'lucide-react';
import { authProvider, type AuthState } from '../lib/auth';
import { loadAdminAccess, loadCharacters } from '../lib/firestore';
import type { CharacterData } from '../types/character';
import { adaptCharacter, battleCostLabel, defaultExtension, extensionFor, getActions, newId } from '../lib/demoGame/adapter';
import { actorById, inputVariables, resourceValue } from '../lib/demoGame/engine';
import { characterContext } from '../lib/demoGame/formula';
import { findMovement, isPlaced, sceneOf, tileAt } from '../lib/demoGame/map';
import { commitDemoCommand, exportDemo, loadDemoSession, resetDemoSession, sessionKey, subscribeDemoSession } from '../lib/demoGame/store';
import type { ActionExtension, Combatant, Command, GameAction, GameSession, Point, ResourceRole } from '../lib/demoGame/types';
import GameBoard, { type BoardTool, TokenImage } from './demoGame/GameBoard';
import GameDialog from './demoGame/GameDialog';
import SpritePicker from './demoGame/SpritePicker';
import CreateSceneForm from './demoGame/CreateSceneForm';
import ExpandSceneForm from './demoGame/ExpandSceneForm';
import BattleActionForm from './demoGame/BattleActionForm';
import { battlePlan } from '../lib/demoGame/battle';
import { battleOperations } from '../lib/battleSettings';
import type { Rotation } from '../lib/demoGame/isometric';
import type { SpritePreset } from '../lib/demoGame/types';
import './demoGame/demoGame.css';

type Dialog = { kind: 'rules' | 'add' | 'reset' | 'help' | 'time' | 'scene' | 'expand' } | { kind: 'actor' | 'remove'; actorId: string } | { kind: 'bar'; actorId: string; barId: string }
  | { kind: 'extension' | 'battle-settings'; actorId: string; actionId: string } | { kind: 'execute'; actorId: string; targetId: string; actionId: string; anchor?: Point; reaction?: boolean };
const labels: Record<ResourceRole, string> = { hp: 'HP', movement: 'MAP', combat: 'CAP', reaction: 'RAP' };
const number = (form: FormData, key: string) => Number(form.get(key));
const text = (form: FormData, key: string) => String(form.get(key) || '');
const rulesTools: { id: BoardTool; label: string; icon: React.ReactNode }[] = [
  { id: 'move', label: 'Move', icon: <Footprints size={17} /> }, { id: 'pan', label: 'Pan camera', icon: <Hand size={17} /> }, { id: 'teleport', label: 'Teleport', icon: <Move size={17} /> },
  { id: 'floor', label: 'Floor', icon: <Grid2X2 size={17} /> }, { id: 'wall', label: 'Wall', icon: <Shield size={17} /> },
  { id: 'difficult', label: 'Difficult terrain', icon: <Mountain size={17} /> }, { id: 'raise', label: 'Raise elevation', icon: <ArrowUp size={17} /> },
  { id: 'lower', label: 'Lower elevation', icon: <ArrowDown size={17} /> }, { id: 'hide', label: 'Hide tile', icon: <EyeOff size={17} /> }, { id: 'reveal', label: 'Reveal tile', icon: <Eye size={17} /> },
  { id: 'void', label: 'Remove floor', icon: <Trash2 size={17} /> },
];

export default function DemoGamePage() {
  const [auth, setAuth] = useState<AuthState>({ uid: null, displayName: null, email: null });
  const [game, setGame] = useState<GameSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isDm, setIsDm] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [tool, setTool] = useState<BoardTool>('move');
  const [destination, setDestination] = useState<Point | null>(null);
  const [targeting, setTargeting] = useState<string | null>(null);
  const [actionTargetIds, setActionTargetIds] = useState<string[]>([]);
  const [aim, setAim] = useState<Point | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [cutaway, setCutaway] = useState(true);
  const [resetView, setResetView] = useState(0);
  const [panel, setPanel] = useState<'character' | 'log'>('character');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [search, setSearch] = useState('');
  const [rollFormula, setRollFormula] = useState('1d20');
  const [toast, setToast] = useState<GameSession['log'][number] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const key = sessionKey(auth.uid);
  const keyRef = useRef(key);
  keyRef.current = key;
  const gameRef = useRef(game);
  gameRef.current = game;
  useEffect(() => authProvider.onAuthChange(setAuth), []);
  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    setGame(null); gameRef.current = null; setBusy(false); setToast(null); setDialog(null); setError(''); setTargeting(null); setDestination(null);
    const refresh = async () => {
      try {
        const loaded = await loadDemoSession(key);
        if (cancelled || keyRef.current !== key) return;
        if (!initialized) { initialized = true; setSelectedId(loaded.world.actors[0]?.id || ''); }
        if (!gameRef.current || loaded.revision > gameRef.current.revision) {
          gameRef.current = loaded;
          setGame(current => current && current.revision > loaded.revision ? current : loaded);
          setDestination(null); setTargeting(null);
        }
      } catch (e) { if (!cancelled && keyRef.current === key) setError(e instanceof Error ? e.message : 'Could not load the demo.'); }
    };
    const unsubscribe = subscribeDemoSession(key, () => void refresh());
    void refresh();
    return () => { cancelled = true; unsubscribe(); };
  }, [key]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 10000); return () => clearTimeout(timer); }, [toast]);
  const world = game?.world;
  const selected = world?.actors.find(a => a.id === selectedId && (isDm || (!a.hidden && (!isPlaced(a) || world.mode !== 'battle' || !tileAt(sceneOf(world), a.position).hidden))));
  const actions = useMemo(() => selected ? getActions(selected) : [], [selected]);
  const movement = useMemo(() => world && selected && destination ? findMovement(world, selected, destination) : null, [world, selected, destination]);
  const context = useMemo(() => selected ? characterContext(selected.character) : {}, [selected]);
  const canControl = (actor?: Combatant) => Boolean(actor && (isDm || actor.team === 'party'));

  const commit = async (command: Command) => {
    if (!game || busy) return false;
    setBusy(true); setError('');
    const requestKey = key;
    try {
      const next = await commitDemoCommand(key, { id: newId(), baseRevision: game.revision, by: auth.displayName || 'Local DM', role: isDm ? 'dm' : 'player', controlledIds: game.world.actors.filter(a => a.team === 'party').map(a => a.id), command });
      if (keyRef.current !== requestKey) return false;
      setGame(current => current && current.revision > next.revision ? current : next); setToast(next.log[next.log.length - 1]); setDestination(null); setTargeting(null);
      return true;
    } catch (e) {
      if (keyRef.current === requestKey) {
        setError(e instanceof Error ? e.message : 'Action failed.');
        try {
          const loaded = await loadDemoSession(key);
          if (keyRef.current === requestKey) setGame(current => current && current.revision > loaded.revision ? current : loaded);
        } catch { /* Keep the visible state available for export. */ }
      }
      return false;
    } finally { if (keyRef.current === requestKey) setBusy(false); }
  };
  const closeAfter = async (command: Command) => { if (await commit(command)) setDialog(null); };
  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await resetDemoSession(key);
      if (keyRef.current !== key) return;
      setGame(current => current && current.revision > fresh.revision ? current : fresh); setSelectedId(fresh.world.actors[0]?.id || ''); setDialog(null); setToast(null); setTargeting(null); setDestination(null); setError('');
    } catch (e) { if (keyRef.current === key) setError(String(e)); }
    finally { if (keyRef.current === key) setBusy(false); }
  };
  const exportSaved = async () => {
    try { await exportDemo(key); }
    catch (e) { if (keyRef.current === key) setError(e instanceof Error ? e.message : 'Export failed.'); }
  };
  const openImport = async () => {
    setDialog({ kind: 'add' }); setLoadingCharacters(true); setSearch(''); setCharacters([]);
    try {
      const admin = await loadAdminAccess(auth.uid, auth.email);
      const loaded = await loadCharacters(auth.uid, admin.isAdmin);
      if (keyRef.current === key) setCharacters(loaded.filter(c => admin.isAdmin || c.userId === auth.uid || (!auth.uid && (!c.userId || c.userId === 'guest')) || (auth.uid && c.controlUserIds?.includes(auth.uid))));
    } catch (e) { setError(String(e)); }
    finally { setLoadingCharacters(false); }
  };
  const importCharacter = async (character: CharacterData) => {
    if (!world) return;
    try {
      const actor = adaptCharacter(character, { x: 0, y: 0 });
      if (await commit({ type: 'add-actor', actor })) { setSelectedId(actor.id); setDialog({ kind: 'actor', actorId: actor.id }); setTool('move'); }
    } catch (e) { setError(String(e)); }
  };
  const chooseAction = (action: GameAction) => {
    if (!selected) return;
    const ext = extensionFor(selected, action);
    setAim(null);
    setDestination(null);
    setActionTargetIds([]);
    if (action.battleSettings?.target === 'multiple') setDialog({ kind: 'execute', actorId: selected.id, targetId: selected.id, actionId: action.id });
    else if (ext.target === 'single') setTargeting(action.id);
    else setDialog({ kind: 'execute', actorId: selected.id, targetId: selected.id, actionId: action.id });
  };
  const selectActor = (id: string) => {
    if (targeting && selected && world?.actors.some(a => a.id === id && isPlaced(a))) { setDialog({ kind: 'execute', actorId: selected.id, targetId: id, actionId: targeting, anchor: world?.actors.find(a => a.id === id)?.position }); return; }
    setSelectedId(id); setDestination(null); setTargeting(null); setPanel('character'); if (world?.actors.find(a => a.id === id)?.placed === false) setTool('move');
  };
  const clickTile = (position: Point) => {
    if (!world || busy || world.pending) return;
    if (targeting) {
      const action = actions.find(a => a.id === targeting);
      if (selected && action?.battleSettings?.target === 'point') setDialog({ kind: 'execute', actorId: selected.id, targetId: selected.id, actionId: action.id, anchor: position });
      return;
    }
    if (tool === 'pan') return;
    if (tool === 'move') { if (selected && !isPlaced(selected)) { if (isDm) void commit({ type: 'place-actor', actorId: selected.id, destination: position }); } else if (canControl(selected)) setDestination(position); return; }
    if (!isDm) return;
    if (tool === 'teleport') { if (selected) void commit({ type: 'teleport', actorId: selected.id, destination: position }); return; }
    const tile = { ...tileAt(sceneOf(world), position) };
    if (tool === 'raise') tile.elevation = Math.min(10, tile.elevation + 1);
    else if (tool === 'lower') tile.elevation = Math.max(0, tile.elevation - 1);
    else if (tool === 'hide' || tool === 'reveal') tile.hidden = tool === 'hide';
    else tile.terrain = tool;
    void commit({ type: 'tile', position, tile });
  };

  if (!game || !world) return <div className="demo-game dg-loading"><p>{error || 'Opening encounter...'}</p>{error && <><button onClick={() => void exportSaved()}>Export saved data</button><button onClick={() => setDialog({ kind: 'reset' })}>Reset demo</button>{dialog?.kind === 'reset' && <GameDialog title="Reset local demo?" onClose={() => setDialog(null)}><p>The previous save will be kept as a local backup.</p><button onClick={() => void reset()}>Reset demo</button></GameDialog>}</>}</div>;
  const scene = sceneOf(world), active = world.actors.find(a => a.id === world.combat.activeId);
  const pending = world.pending?.queue[0];
  const reacting = pending ? actorById(world, pending.actorId) : undefined;
  const aimedAction = actions.find(a => a.id === targeting);
  const targetExtension = aimedAction && selected ? extensionFor(selected, aimedAction) : null;
  const dialogActor = dialog && 'actorId' in dialog ? world.actors.find(a => a.id === dialog.actorId) : undefined;
  const dialogAction = dialogActor && dialog && 'actionId' in dialog ? getActions(dialogActor).find(a => a.id === dialog.actionId) : undefined;
  const dialogExtension = dialogActor && dialogAction ? extensionFor(dialogActor, dialogAction) : defaultExtension();
  const dialogTarget = dialog?.kind === 'execute' ? world.actors.find(a => a.id === dialog.targetId) : undefined;
  const actionInputs = dialogAction ? inputVariables(dialogAction, dialogExtension) : [];
  const arrayEffect = !dialogAction?.battleSettings ? dialogAction?.effects.find(e => e.effectType === 'item-update' && e.itemUpdateArrayMode) : undefined;
  let planned: ReturnType<typeof battlePlan> | undefined, preview: ReturnType<typeof battlePlan> | undefined, planningError = '';
  if (dialog?.kind === 'execute' && dialogActor && dialogAction?.battleSettings) {
    try { planned = battlePlan(world, dialogActor, dialogAction.battleSettings, dialog.anchor || dialogActor.position, dialog.targetId, isDm); }
    catch (e) { planningError = e instanceof Error ? e.message : 'Invalid target'; }
  }
  if (aim && selected && aimedAction?.battleSettings) {
    try { preview = battlePlan(world, selected, aimedAction.battleSettings, aim, world.actors.find(a => isPlaced(a) && a.position.x === aim.x && a.position.y === aim.y)?.id || '', isDm); } catch { /* Hover can be outside the legal target area. */ }
  }
  const battleChoices = new Map<string, { actor: Combatant; effect: GameAction['effects'][number] }>();
  const chosenTargets = dialogAction?.battleSettings?.target === 'multiple' ? planned?.targets.filter(a => actionTargetIds.includes(a.id)) || [] : planned?.targets || [];
  const teleportChoices = new Map<string, Combatant>();
  if (planned && dialogAction?.battleSettings && dialogActor) for (const op of battleOperations(dialogAction.battleSettings)) {
    const effect = op.kind === 'effect' ? dialogAction.effects.find(e => e.id === op.effectId && e.effectType === 'item-update' && e.itemUpdateArrayMode) : undefined;
    if (effect) for (const actor of op.recipient === 'actor' ? [dialogActor] : chosenTargets) battleChoices.set(`${actor.id}/${effect.id}`, { actor, effect });
    if (op.kind === 'teleport') for (const actor of op.recipient === 'actor' ? [dialogActor] : chosenTargets) teleportChoices.set(`${actor.id}/${op.id}`, actor);
  }

  return <div ref={rootRef} className="demo-game" aria-busy={busy}>
    <header className="dg-header">
      <a className="dg-back" href="#tools" title="Back to Tools" aria-label="Back to Tools"><ArrowLeft size={20} /></a>
      <div className="dg-title"><Swords size={23} /><div><h2>Demo Game</h2><span className="dg-save"><i />Local session · {busy ? 'Saving...' : 'Saved'}</span></div></div>
      <div className="dg-segment" aria-label="Game mode"><button disabled={!isDm || busy} aria-pressed={world.mode === 'battle'} onClick={() => void commit({ type: 'mode', mode: 'battle' })}><Swords size={15} />Battle</button><button disabled={!isDm || busy} aria-pressed={world.mode === 'roleplay'} onClick={() => void commit({ type: 'mode', mode: 'roleplay' })}><Users size={15} />Roleplay</button></div>
      <div className="dg-scene-picker"><select aria-label="Scene" value={world.sceneId} disabled={!isDm || busy || world.combat.running} onChange={e => void commit({ type: 'scene', sceneId: e.target.value })}>{world.scenes.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select><button className="dg-icon" title="Add scene" aria-label="Add scene" disabled={!isDm || busy || world.combat.running || Boolean(world.pending) || world.scenes.length >= 12} onClick={() => setDialog({ kind: 'scene' })}><Plus size={17} /></button></div>
      <div className="dg-header-tools">
        <button className="dg-icon" title="Undo latest command" aria-label="Undo latest command" disabled={!isDm || busy || !game.undo.length} onClick={() => void commit({ type: 'undo' })}><Undo2 size={18} /></button>
        <button className="dg-icon" title="Encounter settings" aria-label="Encounter settings" disabled={!isDm} onClick={() => setDialog({ kind: 'rules' })}><Settings2 size={18} /></button>
        <button className="dg-icon" title="Export encounter JSON" aria-label="Export encounter JSON" onClick={() => void exportSaved()}><Download size={18} /></button>
        <button className="dg-icon" title="New demo encounter" aria-label="New demo encounter" disabled={!isDm} onClick={() => setDialog({ kind: 'reset' })}><RotateCcw size={17} /></button>
        <button className="dg-icon" title="Session information" aria-label="Session information" onClick={() => setDialog({ kind: 'help' })}><CircleHelp size={18} /></button>
        <select aria-label="View mode" value={isDm ? 'dm' : 'player'} onChange={e => { setIsDm(e.target.value === 'dm'); setTool('move'); setTargeting(null); setDestination(null); setDialog(null); }}><option value="dm">DM view</option><option value="player">Player preview</option></select>
      </div>
    </header>
    {error && <div className="dg-error" role="alert">{error}<button className="dg-icon" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    <div className="dg-turnbar"><div><span className="dg-eyebrow">{world.combat.running ? `Round ${world.combat.round}` : 'Encounter setup'}</span><strong>{world.combat.running ? active?.character.name : world.name}</strong></div><div className="dg-row">
      <button disabled={!isDm || busy} onClick={() => setDialog({ kind: 'time' })}><Hourglass size={15} />Proceed time</button>
      {world.combat.running ? <button className="dg-primary" disabled={busy || !canControl(active) || Boolean(world.pending)} onClick={() => void commit({ type: 'end-turn' })}>End turn<ChevronRight size={16} /></button> : <button className="dg-primary" disabled={!isDm || busy || !world.actors.length} onClick={() => void commit({ type: 'start' })}><Play size={15} />Start battle</button>}
    </div></div>
    <div className="dg-workspace">
      <main className="dg-stage">
        <div className="dg-board-toolbar"><div className="dg-row">{(isDm ? rulesTools : rulesTools.slice(0, 2)).map(t => <button key={t.id} className="dg-icon" title={t.label} aria-label={t.label} aria-pressed={tool === t.id} disabled={world.mode !== 'battle' || busy || Boolean(world.pending)} onClick={() => { setTool(t.id); setTargeting(null); setDestination(null); }}>{t.icon}</button>)}</div><div className="dg-row"><button className="dg-icon" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .25))}><Minus size={16} /></button><span className="dg-zoom">{Math.round(zoom * 100)}%</span><button className="dg-icon" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 2.5} onClick={() => setZoom(z => Math.min(2.5, z + .25))}><Plus size={16} /></button></div></div>
        {world.mode === 'battle' && <div className="dg-camera-tools"><span>Isometric view</span><button className="dg-icon" title="Expand grid" aria-label="Expand grid" disabled={!isDm || busy || Boolean(world.pending)} onClick={() => setDialog({ kind: 'expand' })}><Grid2X2 size={16} /></button><div className="dg-row"><button className="dg-icon" title="Rotate view left" aria-label="Rotate view left" onClick={() => setRotation(r => ((r + 3) % 4) as Rotation)}><RotateCcw size={16} /></button><button className="dg-icon" title="Rotate view right" aria-label="Rotate view right" onClick={() => setRotation(r => ((r + 1) % 4) as Rotation)}><RotateCw size={16} /></button><button className="dg-icon" title="Lower foreground walls" aria-label="Lower foreground walls" aria-pressed={cutaway} onClick={() => setCutaway(v => !v)}><PanelBottomClose size={16} /></button><button className="dg-icon" title="Reset view" aria-label="Reset view" onClick={() => { setZoom(1); setRotation(0); setResetView(v => v + 1); rootRef.current?.querySelector('.dg-board-scroll')?.scrollTo({ left: 0, top: 0 }); }}><Scan size={16} /></button></div></div>}
        <GameBoard world={world} selected={selected} isDm={isDm} tool={tool} path={movement?.path || []} range={targetExtension?.range} targeting={Boolean(targeting)} zoom={zoom} rotation={rotation} cutaway={cutaway} resetView={resetView} area={planned?.cells || preview?.cells || []} onAimHover={setAim} event={game.log[game.log.length - 1]} onTile={clickTile} onActor={selectActor} onRoleplayMove={position => { if (selected && canControl(selected)) void commit({ type: isPlaced(selected) ? 'roleplay-move' : 'place-actor', actorId: selected.id, destination: position }); }} />
        <div className="dg-contextbar" aria-live="polite">
          {world.pending && reacting ? <><span><Hand size={16} /><strong>{reacting.character.name}</strong> · Reaction available</span><div className="dg-row"><button disabled={!canControl(reacting) || busy} onClick={() => void commit({ type: 'reaction', use: false, inputs: {} })}>Ignore</button><button className="dg-primary" disabled={!canControl(reacting) || busy} onClick={() => setDialog({ kind: 'execute', actorId: reacting.id, targetId: world.pending!.actorId, actionId: pending!.actionId, reaction: true })}>Use reaction</button>{isDm && <button className="dg-icon" title="Stop movement" aria-label="Stop movement" onClick={() => void commit({ type: 'cancel-move' })}><X size={16} /></button>}</div></>
            : targeting ? <><span><WandSparkles size={16} />{actions.find(a => a.id === targeting)?.name} · Select a target</span><button onClick={() => setTargeting(null)}>Cancel</button></>
              : destination && selected ? <><span><Footprints size={16} />{movement?.path.length ? `${destination.x}, ${destination.y} / ${world.combat.running ? `${movement.cost} MAP` : 'Setup movement'}` : 'No traversable path'}</span><div className="dg-row"><button onClick={() => setDestination(null)}>Cancel</button><button className="dg-primary" disabled={busy || !movement?.path.length || movement.path.length < 2 || (world.combat.running && (resourceValue(selected, 'movement') ?? -1) < movement.cost)} onClick={() => void commit({ type: 'move', actorId: selected.id, destination })}><Check size={15} />Move</button></div></>
                : <><span>{selected ? `${selected.character.name}${!isPlaced(selected) ? ' / Select a floor tile to place' : ''}` : 'Select a combatant'}</span><span>{world.mode === 'battle' ? `${world.rules.orthogonalCost} / ${world.rules.diagonalCost} MAP` : scene.name}</span></>}
        </div>
        <div className="dg-roster">{world.actors.filter(a => isDm || (!a.hidden && (!isPlaced(a) || !tileAt(scene, a.position).hidden))).map(actor => <div key={actor.id} className="dg-roster-entry">
          <button className={`dg-roster-item ${actor.team}`} aria-pressed={selectedId === actor.id} title={actor.character.name} onClick={() => selectActor(actor.id)}><div className="dg-avatar"><TokenImage actor={actor} /></div><span><strong>{actor.character.name}</strong><small>{!isPlaced(actor) ? 'Not placed' : world.combat.activeId === actor.id && world.combat.running ? 'Current turn' : actor.team} · {actor.initiative}</small></span></button>
          {isDm && <div className="dg-roster-controls"><button className="dg-icon" disabled={busy || !isPlaced(actor) || Boolean(world.pending)} aria-label={`Remove ${actor.character.name} token`} title="Remove token from map" onClick={() => void commit({ type: 'unplace-actor', actorId: actor.id })}><UserMinus size={14} /></button><button className="dg-icon dg-danger" disabled={busy || Boolean(world.pending)} aria-label={`Remove ${actor.character.name} from encounter`} title="Remove character from encounter" onClick={() => setDialog({ kind: 'remove', actorId: actor.id })}><Trash2 size={14} /></button></div>}
        </div>)}<button className="dg-add" disabled={!isDm} onClick={() => void openImport()}><Plus size={18} />Add character</button></div>
      </main>
      <aside className="dg-inspector">
        <div className="dg-panel-tabs"><button aria-pressed={panel === 'character'} onClick={() => setPanel('character')}>Combatant</button><button aria-pressed={panel === 'log'} onClick={() => setPanel('log')}>Log <small>{game.log.length}</small></button></div>
        {panel === 'log' ? <div className="dg-log">{[...game.log].reverse().map(event => <article key={event.id}><small>#{event.revision} · {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><strong>{event.message}</strong>{event.details.map((detail, i) => <p key={i}>{detail}</p>)}</article>)}{!game.log.length && <p className="dg-muted">No events yet.</p>}</div> : selected ? <>
          <div className="dg-actor-heading"><div className="dg-avatar"><TokenImage actor={selected} /></div><div><span className="dg-eyebrow">{selected.team} · {selected.state}</span><h3>{selected.character.name}</h3></div><button className="dg-icon" title="Combatant settings" aria-label="Combatant settings" disabled={!isDm} onClick={() => setDialog({ kind: 'actor', actorId: selected.id })}><Settings2 size={17} /></button></div>
          <div className="dg-resources">{(Object.keys(labels) as ResourceRole[]).map(role => <button key={role} disabled={!selected.bindings[role] || !canControl(selected)} onClick={() => setDialog({ kind: 'bar', actorId: selected.id, barId: selected.bindings[role] })}><span>{labels[role]}</span><strong>{resourceValue(selected, role) ?? '-'}</strong></button>)}</div>
          <section className="dg-section"><h4>Actions <span>{actions.length}</span></h4><div className="dg-action-list">{actions.map(action => { const ext = extensionFor(selected, action); return <div className="dg-action" key={action.id}><button disabled={busy || !canControl(selected) || !isPlaced(selected) || Boolean(world.pending) || Boolean(ext.reaction)} onClick={() => chooseAction(action)}><span><strong>{action.name}</strong><small>{action.sourceName}{ext.reaction ? ' · Reaction' : ''}</small></span><span className="dg-action-cost">{action.battleSettings ? battleCostLabel(selected, action) : ext.cost > 0 ? `${ext.cost} ${ext.costResource === 'combat' ? 'CAP' : 'RAP'}` : 'Roll / Apply'}</span></button><button className="dg-icon" title={`Configure ${action.name}`} aria-label={`Configure ${action.name}`} disabled={!isDm} onClick={() => setDialog({ kind: action.battleSettings ? 'battle-settings' : 'extension', actorId: selected.id, actionId: action.id })}><Settings2 size={14} /></button></div>; })}{!actions.length && <p className="dg-muted">No active actions.</p>}</div></section>
          <section className="dg-section"><h4>Quick roll</h4><form className="dg-quick-roll" onSubmit={event => { event.preventDefault(); void commit({ type: 'roll', actorId: selected.id, formula: rollFormula, inputs: {} }); }}><input aria-label="Roll formula" value={rollFormula} onChange={e => setRollFormula(e.target.value)} required /><button type="submit" disabled={busy || !canControl(selected)}><Play size={15} />Roll</button></form></section>
          <section className="dg-section"><h4>Bars</h4>{(selected.character.bars || []).map(bar => { const current = context[`${bar.id}_current`] ?? 0, max = context[`${bar.id}_${bar.mode === 'resource' ? 'reset' : 'max'}`] ?? 0; return <button className="dg-bar-row" key={bar.id} disabled={!canControl(selected)} onClick={() => setDialog({ kind: 'bar', actorId: selected.id, barId: bar.id })}><span>{bar.name}<b>{current} / {max}</b></span><i><em style={{ width: `${max > 0 ? Math.max(0, Math.min(100, current / max * 100)) : 0}%`, backgroundColor: bar.color || '#75dbb7' }} /></i></button>; })}</section>
          <section className="dg-section"><h4>Statuses</h4>{(selected.character.statuses || []).map(status => <div className="dg-status" key={status.id}><button className="dg-icon" title={status.active === false ? 'Activate status' : 'Deactivate status'} aria-label={`${status.active === false ? 'Activate' : 'Deactivate'} ${status.name}`} disabled={!canControl(selected)} onClick={() => void commit({ type: 'status', actorId: selected.id, statusId: status.id, operation: 'toggle' })}>{status.active === false ? <EyeOff size={15} /> : <Eye size={15} />}</button><span>{status.name}<small>{status.duration} {status.durationType || 'custom'}</small></span><button className="dg-icon dg-danger" title="Remove status" aria-label={`Remove ${status.name}`} disabled={!canControl(selected)} onClick={() => void commit({ type: 'status', actorId: selected.id, statusId: status.id, operation: 'delete' })}><Trash2 size={14} /></button></div>)}{!selected.character.statuses?.length && <p className="dg-muted">No statuses.</p>}</section>
          {selected.state !== 'active' && <section className="dg-section"><h4>Death saves</h4><div className="dg-row"><button disabled={!canControl(selected)} onClick={() => void commit({ type: 'death-save', actorId: selected.id, result: 'success' })}>Saves {selected.deathSaves.successes}/3</button><button disabled={!canControl(selected)} onClick={() => void commit({ type: 'death-save', actorId: selected.id, result: 'failure' })}>Fails {selected.deathSaves.failures}/3</button><button className="dg-icon" title="Clear death saves" aria-label="Clear death saves" disabled={!canControl(selected)} onClick={() => void commit({ type: 'death-save', actorId: selected.id, result: 'clear' })}><RotateCcw size={14} /></button></div></section>}
        </> : <p className="dg-muted">Select a combatant.</p>}
      </aside>
    </div>
    {toast && <div className="dg-toast" role="status" onClick={() => setToast(null)}><button className="dg-icon" title="Dismiss result" aria-label="Dismiss result"><X size={15} /></button><strong>{toast.message}</strong>{toast.details.slice(-5).map((d, i) => <p key={i}>{d}</p>)}{isDm && game.revision === toast.revision && toast.type !== 'undo' && <button onClick={event => { event.stopPropagation(); void commit({ type: 'undo' }); }}><Undo2 size={14} />Take it back</button>}</div>}
    {dialog && <GameDialog title={dialog.kind === 'remove' ? 'Remove character from encounter?' : dialog.kind === 'battle-settings' ? 'Battle Settings' : dialog.kind === 'expand' ? 'Expand grid' : dialog.kind === 'scene' ? 'New scene' : dialog.kind === 'rules' ? 'Encounter settings' : dialog.kind === 'actor' ? 'Combatant settings' : dialog.kind === 'extension' ? 'Battle action' : dialog.kind === 'execute' ? dialogAction?.name || 'Action' : dialog.kind === 'bar' ? 'Update bar' : dialog.kind === 'add' ? 'Add character snapshot' : dialog.kind === 'reset' ? 'Reset demo encounter?' : dialog.kind === 'time' ? 'Proceed time' : 'Demo session'} onClose={() => setDialog(null)}>
      {error && <p className="dg-error" role="alert">{error}</p>}
      {dialog.kind === 'expand' && <ExpandSceneForm scene={scene} busy={busy} onExpand={closeAfter} />}
      {dialog.kind === 'remove' && dialogActor && <><p>{dialogActor.character.name} will be removed from this encounter and all its scenes. The original character sheet is unchanged.</p><div className="dg-dialog-actions"><button onClick={() => setDialog(null)}>Cancel</button><button className="dg-danger" disabled={busy} onClick={() => void closeAfter({ type: 'remove-actor', actorId: dialogActor.id })}><Trash2 size={15} />Remove from encounter</button></div></>}
      {dialog.kind === 'battle-settings' && dialogActor && dialogAction && <BattleActionForm action={dialogAction} bars={dialogActor.character.bars} busy={busy} onSave={(settings, effects) => void closeAfter({ type: 'battle-settings', actorId: dialogActor.id, actionId: dialogAction.id, settings, effects })} />}
      {dialog.kind === 'scene' && <CreateSceneForm scene={scene} busy={busy} onCreate={closeAfter} />}
      {dialog.kind === 'help' && <div className="dg-help"><p>This encounter is saved in this browser. Character imports are independent snapshots; their original sheets are not modified.</p><p>Battle supports movement, initiative, rolls, resource costs, status and item effects, and adjacency reactions. Configure imported actions and resource bindings before use.</p><p>DM view and Player preview share this local session. Online players, automatic vision, advanced cover and automatic downed prevention are not connected yet.</p><p>Round-duration effects follow the current sheet behavior: they advance at the end of that combatant's turn. HP reaching zero does not automatically change state; the DM can set it in combatant settings.</p></div>}
      {dialog.kind === 'reset' && <><p>Replace this local encounter with the starter scene? The current save is kept as a local backup.</p><div className="dg-dialog-actions"><button onClick={() => void exportSaved()}><Download size={15} />Export JSON</button><button className="dg-danger" onClick={() => void reset()}>Reset encounter</button></div></>}
      {dialog.kind === 'add' && <><input autoFocus aria-label="Search characters" placeholder="Search characters" value={search} onChange={e => setSearch(e.target.value)} /><div className="dg-import-list">{loadingCharacters ? <p>Loading characters...</p> : characters.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).map(c => <button key={c.id} disabled={busy} onClick={() => void importCharacter(c)}><span><strong>{c.name}</strong><small>{c.className || c.race}</small></span><Plus size={17} /></button>)}{!loadingCharacters && !characters.length && <p>No controllable characters found for this account.</p>}</div></>}
      {dialog.kind === 'time' && <div className="dg-time-options">{([{ action: 'short-rest', name: 'Short Rest' }, { action: 'long-rest', name: 'Long Rest' }, { action: 'skip-minute', name: 'Skip Minute' }, { action: 'end-battle', name: 'End Battle' }] as const).map(option => <button key={option.action} disabled={busy} onClick={() => void closeAfter({ type: 'time', action: option.action })}><Hourglass size={17} />{option.name}<ChevronRight size={15} /></button>)}</div>}
      {dialog.kind === 'rules' && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void closeAfter({ type: 'rules', rules: { orthogonalCost: number(f, 'orthogonal'), diagonalCost: number(f, 'diagonal'), elevationCost: number(f, 'elevation'), maxStepHeight: number(f, 'height'), strictTurns: f.has('strict') } }); }}>
        <div className="dg-form-grid"><label>Orthogonal MAP<input type="number" step="any" min="0.01" name="orthogonal" defaultValue={world.rules.orthogonalCost} required /></label><label>Diagonal MAP<input type="number" step="any" min="0.01" name="diagonal" defaultValue={world.rules.diagonalCost} required /></label><label>Climb cost / level<input type="number" step="any" min="0" name="elevation" defaultValue={world.rules.elevationCost} required /></label><label>Max step height<input type="number" min="0" max="10" name="height" defaultValue={world.rules.maxStepHeight} required /></label></div><label className="dg-checkbox"><input type="checkbox" name="strict" defaultChecked={world.rules.strictTurns} />Enforce turn order</label><div className="dg-dialog-actions"><button type="submit" className="dg-primary" disabled={busy}>Save rules</button></div>
        <label>Scene image URL<input type="url" name="background" defaultValue={scene.background} placeholder="https://..." /></label><button type="button" disabled={busy} onClick={event => { const form = event.currentTarget.form!; void commit({ type: 'scene-background', url: String(new FormData(form).get('background') || '').trim() }); }}>Set background</button>
      </form>}
      {dialog.kind === 'actor' && dialogActor && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void closeAfter({ type: 'actor-settings', actorId: dialogActor.id, bindings: Object.fromEntries((Object.keys(labels) as ResourceRole[]).map(role => [role, text(f, role)])) as Combatant['bindings'], team: text(f, 'team') as Combatant['team'], initiative: number(f, 'initiative'), state: text(f, 'state') as Combatant['state'], locked: f.has('locked'), hidden: f.has('hidden'), sprite: text(f, 'sprite') as SpritePreset }); }}>
        <SpritePicker actor={dialogActor} />
        <strong>{dialogActor.character.name}</strong><div className="dg-form-grid">{(Object.keys(labels) as ResourceRole[]).map(role => <label key={role}>{labels[role]} binding<select name={role} defaultValue={dialogActor.bindings[role]}><option value="">Unbound</option>{(dialogActor.character.bars || []).map(b => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}</select></label>)}<label>Team<select name="team" defaultValue={dialogActor.team}><option value="party">Party</option><option value="opposition">Opposition</option><option value="neutral">Neutral</option></select></label><label>Initiative<input name="initiative" type="number" step="any" required defaultValue={dialogActor.initiative} /></label><label>State<select name="state" defaultValue={dialogActor.state}><option value="active">Active</option><option value="downed">Downed</option><option value="unconscious">Unconscious</option></select></label></div><label className="dg-checkbox"><input type="checkbox" name="locked" defaultChecked={dialogActor.locked} />Lock token for players</label><label className="dg-checkbox"><input type="checkbox" name="hidden" defaultChecked={dialogActor.hidden} />Hide from player preview</label><div className="dg-dialog-actions"><button type="button" className="dg-danger" disabled={busy} onClick={() => setDialog({ kind: 'remove', actorId: dialogActor.id })}><Trash2 size={15} />Remove</button><button className="dg-primary" disabled={busy} type="submit">Save</button></div>
      </form>}
      {dialog.kind === 'extension' && dialogActor && dialogAction && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void closeAfter({ type: 'extension', actorId: dialogActor.id, actionId: dialogAction.id, extension: { target: text(f, 'target') as ActionExtension['target'], range: number(f, 'range'), cost: number(f, 'cost'), costResource: text(f, 'costResource') as ActionExtension['costResource'], requiresLOS: f.has('los'), damageFormula: text(f, 'damage'), defenseId: text(f, 'defense'), ...(f.has('reaction') ? { reaction: 'leave-adjacency' as const } : {}) } }); }}>
        <strong>{dialogAction.name}</strong><p className="dg-muted">{dialogAction.sourceName}{dialogAction.costLabel ? ` · Sheet cost: ${dialogAction.costLabel}` : ''}</p><code>{dialogAction.formula || dialogAction.effects.map(e => e.effectType).join(', ')}</code><div className="dg-form-grid"><label>Target<select name="target" defaultValue={dialogExtension.target}><option value="self">Self</option><option value="single">Single combatant</option></select></label><label>Range (tiles)<input name="range" type="number" min="0" max="100" required defaultValue={dialogExtension.range} /></label><label>AP cost<input name="cost" type="number" min="0" step="any" required defaultValue={dialogExtension.cost} /></label><label>Resource<select name="costResource" defaultValue={dialogExtension.costResource}><option value="combat">CAP</option><option value="reaction">RAP</option></select></label></div><label>Target defense attribute ID<input name="defense" defaultValue={dialogExtension.defenseId} placeholder="ac" /></label><label>Damage formula<input name="damage" defaultValue={dialogExtension.damageFormula} placeholder="1d6 + @str_mod" /></label><label className="dg-checkbox"><input type="checkbox" name="los" defaultChecked={dialogExtension.requiresLOS} />Require line of sight</label><label className="dg-checkbox"><input type="checkbox" name="reaction" defaultChecked={Boolean(dialogExtension.reaction)} />Reaction: opponent leaves adjacency</label><div className="dg-dialog-actions"><button type="submit" className="dg-primary" disabled={busy}>Save action</button></div>
      </form>}
      {dialog.kind === 'bar' && dialogActor && (() => { const bar = dialogActor.character.bars?.find(b => b.id === dialog.barId); if (!bar) return <p>Bar no longer exists.</p>; const ctx = characterContext(dialogActor.character); return <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget), input = text(f, 'amount').trim(); if (!/^[+=-]?\d+(\.\d+)?$/.test(input)) { setError('Use +100, -100 or =100.'); return; } void closeAfter({ type: 'bar', actorId: dialogActor.id, barId: bar.id, value: Number(input.replace(/^=/, '')), operation: input.startsWith('=') || !/^[+-]/.test(input) ? 'set' : 'add', canOverflow: f.has('overflow') }); }}><div className="dg-bar-value"><Heart size={20} />{bar.name}<strong>{ctx[`${bar.id}_current`]} / {ctx[`${bar.id}_${bar.mode === 'resource' ? 'reset' : 'max'}`]}</strong></div><label>Change<input name="amount" placeholder="-10 / +10 / =10" required autoFocus /></label><label className="dg-checkbox"><input name="overflow" type="checkbox" />Can overflow</label><div className="dg-dialog-actions"><button type="submit" disabled={busy} className="dg-primary">Apply</button></div></form>; })()}
      {dialog.kind === 'execute' && dialogActor && dialogAction && dialogTarget && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); const inputs = Object.fromEntries(actionInputs.map(v => [v.id, number(f, v.id)])); void closeAfter(dialog.reaction ? { type: 'reaction', use: true, inputs, itemId: text(f, 'item') || undefined } : { type: 'action', actorId: dialogActor.id, targetId: dialogTarget.id, actionId: dialogAction.id, inputs, itemId: text(f, 'item') || undefined, anchor: dialog.anchor, targetIds: actionTargetIds, destinations: Object.fromEntries([...teleportChoices.keys()].map(key => [key, { x: number(f, `destination-x:${key}`), y: number(f, `destination-y:${key}`) }])), choices: Object.fromEntries([...f.entries()].filter(([key]) => key.startsWith('choice:')).map(([key, value]) => [key.slice(7), String(value)])) }); }}>
        <div className="dg-action-summary"><strong>{dialogActor.character.name}</strong><ChevronRight size={18} /><strong>{dialogTarget.character.name}</strong></div><p className="dg-muted">{dialogAction.battleSettings ? battleCostLabel(dialogActor, dialogAction) : `${dialogExtension.cost} ${dialogExtension.costResource === 'combat' ? 'CAP' : 'RAP'}`}{dialogAction.remaining !== undefined ? ` · Uses: ${dialogAction.remaining}` : ''}</p><code>{dialogAction.formula || dialogAction.effects.map(e => `${e.effectType}: ${e.value}`).join(' · ')}</code>{dialogExtension.damageFormula && <code>Damage: {dialogExtension.damageFormula}</code>}
        {dialogAction.battleSettings && <section className="dg-area-targets"><h3>Affected characters ({planned?.targets.length || 0})</h3>{planningError && <p role="alert">{planningError}</p>}{planned && !planned.targets.length && <p>No eligible targets.</p>}{dialogAction.battleSettings.target === 'multiple' ? <><strong>{chosenTargets.length} / {planned?.limit} selected</strong>{planned?.targets.map(a => <label className="dg-checkbox" key={a.id}><input type="checkbox" checked={actionTargetIds.includes(a.id)} disabled={!actionTargetIds.includes(a.id) && chosenTargets.length >= (planned?.limit || 0)} onChange={e => setActionTargetIds(ids => e.target.checked ? [...ids, a.id] : ids.filter(id => id !== a.id))} />{a.character.name}</label>)}</> : planned?.targets.map(a => <span key={a.id}>{a.character.name}</span>)}<code>{dialogAction.battleSettings.check === 'none' ? 'Automatic' : `${dialogAction.battleSettings.actorFormula} vs ${dialogAction.battleSettings.targetFormula}`}</code></section>}
        {[...teleportChoices].map(([key, actor]) => <fieldset className="dg-teleport-destination" key={key}><legend>{actor.character.name}: Teleport destination</legend><div className="dg-form-grid"><label>Tile X<input name={`destination-x:${key}`} type="number" step="1" required defaultValue={actor.position.x} /></label><label>Tile Y<input name={`destination-y:${key}`} type="number" step="1" required defaultValue={actor.position.y} /></label></div></fieldset>)}
        {[...battleChoices].map(([key, { actor, effect }]) => <label key={key}>{actor.character.name}: Item<select name={`choice:${key}`} required defaultValue=""><option value="" disabled>Select an item</option>{[...actor.character.inventory || [], ...actor.character.generalItems || []].filter(item => effect.itemUpdateIds?.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name} / Quantity {item.quantity}</option>)}</select></label>)}
        {actionInputs.map(v => <label key={v.id}>{v.description || v.id}<small>@@{v.id}</small><input name={v.id} type="number" step="any" required autoFocus /></label>)}
        {arrayEffect && <label>Item<select name="item" required defaultValue=""><option value="" disabled>Select an item</option>{[...dialogTarget.character.inventory || [], ...dialogTarget.character.generalItems || []].filter(i => arrayEffect.itemUpdateIds?.includes(i.id)).map(i => <option key={i.id} value={i.id}>{i.name} · Quantity {i.quantity}</option>)}</select></label>}
        <div className="dg-dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="dg-primary" disabled={busy || Boolean(planningError) || Boolean(dialogAction.battleSettings && !chosenTargets.length)}><Play size={16} />{dialog.reaction ? 'Use reaction' : 'Confirm'}</button></div>
      </form>}
    </GameDialog>}
  </div>;
}
