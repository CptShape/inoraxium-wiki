import { defaultWorldMapAtlas } from '../data/inoraxium/worldbuilding-handbook/chapters/map/worldMapAtlas.ts';

import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, Copy, Crosshair, Download, Eye, EyeOff,
  Map, Pencil, Plus, RefreshCw, Trash2, Upload, X,
} from 'lucide-react';
import { WorldMapAtlas, WorldMapHotspot, WorldMapNode } from '../types/worldMap';

// ─── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'eldritch-grimoire-world-map-atlas';

const loadAtlas = (): WorldMapAtlas => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* fall through */ }
  return defaultWorldMapAtlas;
};

const saveAtlas = (atlas: WorldMapAtlas) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(atlas));
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const HOTSPOT_COLORS = [
  '#f59e0b', '#ef4444', '#10b981', '#3b82f6',
  '#a78bfa', '#f97316', '#ec4899', '#14b8a6',
];

// ─── Types ────────────────────────────────────────────────────────────────────

type DragPoint = { x: number; y: number };

// ─── Component ────────────────────────────────────────────────────────────────

export const WorldMap: React.FC = () => {
  const [atlas, setAtlas] = useState<WorldMapAtlas>(loadAtlas);
  const [currentMapId, setCurrentMapId] = useState(atlas.rootMapId);
  const [showHotspots, setShowHotspots] = useState(true);

  // ── Modes (mutually exclusive) ──────────────────────────────────────────────
  type Mode = 'view' | 'coordinate-helper' | 'edit';
  const [mode, setMode] = useState<Mode>('view');

  // ── Coordinate-helper state ─────────────────────────────────────────────────
  const [helperFirstPoint, setHelperFirstPoint] = useState<DragPoint | null>(null);
  const [helperResult, setHelperResult] = useState<string>('');

  // ── Edit mode state ─────────────────────────────────────────────────────────
  const [editFirstPoint, setEditFirstPoint] = useState<DragPoint | null>(null);
  // preview rect while user is dragging the second point
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // which hotspot id is currently being renamed/configured
  const [editingHotspotId, setEditingHotspotId] = useState<string | null>(null);

  const currentMap: WorldMapNode = atlas.maps[currentMapId] ?? atlas.maps[atlas.rootMapId];

  // ── Breadcrumb path ─────────────────────────────────────────────────────────
  const path = useMemo(() => {
    const result: string[] = [];
    let cursor = currentMapId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      result.unshift(cursor);
      const parent = Object.values(atlas.maps).find((node) =>
        node.hotspots.some((h) => h.targetMapId === cursor)
      );
      if (!parent) break;
      cursor = parent.id;
    }
    return result;
  }, [atlas.maps, currentMapId]);

  // ── Atlas mutations ─────────────────────────────────────────────────────────

  const updateAtlas = (next: WorldMapAtlas) => {
    setAtlas(next);
    saveAtlas(next);
  };

  const patchCurrentMap = (patch: Partial<WorldMapNode>) => {
    updateAtlas({
      ...atlas,
      maps: {
        ...atlas.maps,
        [currentMapId]: { ...currentMap, ...patch },
      },
    });
  };

  const updateHotspot = (hotspotId: string, patch: Partial<WorldMapHotspot>) => {
    patchCurrentMap({
      hotspots: currentMap.hotspots.map((h) =>
        h.id === hotspotId ? { ...h, ...patch } : h
      ),
    });
  };

  const resetAtlas = () => {
    const confirmed = window.confirm('Clear saved world map edits from this browser and reload the default atlas?');
    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);
    const freshAtlas = structuredClone(defaultWorldMapAtlas);
    setAtlas(freshAtlas);
    setCurrentMapId(freshAtlas.rootMapId);
    setMode('view');
    setHelperFirstPoint(null);
    setHelperResult('');
    setEditFirstPoint(null);
    setPreviewRect(null);
    setEditingHotspotId(null);
  };

  const collectDescendantMapIds = (mapId: string, collected = new Set<string>()) => {
    if (!mapId || collected.has(mapId)) return collected;
    collected.add(mapId);

    const mapNode = atlas.maps[mapId];
    if (!mapNode) return collected;

    for (const childHotspot of mapNode.hotspots) {
      if (childHotspot.targetMapId) {
        collectDescendantMapIds(childHotspot.targetMapId, collected);
      }
    }

    return collected;
  };

  const deleteHotspot = (hotspotId: string) => {
    const hotspot = currentMap.hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) return;

    const mapsToDelete = hotspot.targetMapId
      ? collectDescendantMapIds(hotspot.targetMapId)
      : new Set<string>();

    const nextMaps: WorldMapAtlas['maps'] = {};
    for (const [mapId, mapNode] of Object.entries(atlas.maps)) {
      if (mapsToDelete.has(mapId)) continue;

      nextMaps[mapId] = {
        ...mapNode,
        hotspots: mapNode.hotspots.filter((h) => {
          if (mapId === currentMapId && h.id === hotspotId) return false;
          if (h.targetMapId && mapsToDelete.has(h.targetMapId)) return false;
          return true;
        }),
      };
    }

    updateAtlas({
      ...atlas,
      maps: nextMaps,
    });

    if (editingHotspotId === hotspotId) setEditingHotspotId(null);

    if (!nextMaps[currentMapId]) {
      setCurrentMapId(atlas.rootMapId);
    }
  };

  /** Makes a hotspot navigable by creating an empty child map for it. */
  const makeNested = (hotspot: WorldMapHotspot) => {
    const childId = hotspot.targetMapId || `${currentMapId}_${hotspot.id}_map`;
    const childMap: WorldMapNode = atlas.maps[childId] ?? {
      id: childId,
      title: hotspot.label,
      subtitle: '',
      imageUrl: '',
      description: '',
      hotspots: [],
    };
    const updatedHotspot: WorldMapHotspot = { ...hotspot, targetMapId: childId };
    updateAtlas({
      ...atlas,
      maps: {
        ...atlas.maps,
        [childId]: childMap,
        [currentMapId]: {
          ...currentMap,
          hotspots: currentMap.hotspots.map((h) =>
            h.id === hotspot.id ? updatedHotspot : h
          ),
        },
      },
    });
  };

  /** Removes the nested child map link from a hotspot (makes it non-navigable). */
  const removeNested = (hotspot: WorldMapHotspot) => {
    updateHotspot(hotspot.id, { targetMapId: '' });
  };

  // ── Import / Export ─────────────────────────────────────────────────────────

  const importAtlas = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as WorldMapAtlas;
        if (parsed.rootMapId && parsed.maps) {
          updateAtlas(parsed);
          setCurrentMapId(parsed.rootMapId);
        }
      } catch {
        alert('Invalid map atlas JSON.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const exportAtlas = () => {
    const blob = new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'world-map-atlas.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // ── Map click handler ───────────────────────────────────────────────────────

  const getClickPercent = (event: React.MouseEvent<HTMLDivElement>): DragPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Number((((event.clientX - rect.left) / rect.width) * 100).toFixed(2)),
      y: Number((((event.clientY - rect.top) / rect.height) * 100).toFixed(2)),
    };
  };

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = getClickPercent(event);

    if (mode === 'coordinate-helper') {
      if (!helperFirstPoint) {
        setHelperFirstPoint(point);
        setHelperResult(`First corner: x ${point.x}, y ${point.y}. Click the opposite corner.`);
        return;
      }
      const result = {
        x: Number(Math.min(helperFirstPoint.x, point.x).toFixed(2)),
        y: Number(Math.min(helperFirstPoint.y, point.y).toFixed(2)),
        w: Number(Math.abs(helperFirstPoint.x - point.x).toFixed(2)),
        h: Number(Math.abs(helperFirstPoint.y - point.y).toFixed(2)),
      };
      setHelperResult(JSON.stringify(result, null, 2));
      setHelperFirstPoint(null);
      return;
    }

    if (mode === 'edit') {
      if (!editFirstPoint) {
        setEditFirstPoint(point);
        setPreviewRect({ x: point.x, y: point.y, w: 0, h: 0 });
        return;
      }

      // Second click: commit the hotspot
      const newHotspot: WorldMapHotspot = {
        id: uid(),
        label: 'New Location',
        targetMapId: '',
        x: Number(Math.min(editFirstPoint.x, point.x).toFixed(2)),
        y: Number(Math.min(editFirstPoint.y, point.y).toFixed(2)),
        w: Number(Math.abs(editFirstPoint.x - point.x).toFixed(2)),
        h: Number(Math.abs(editFirstPoint.y - point.y).toFixed(2)),
        color: HOTSPOT_COLORS[currentMap.hotspots.length % HOTSPOT_COLORS.length],
        description: '',
      };

      patchCurrentMap({ hotspots: [...currentMap.hotspots, newHotspot] });
      setEditFirstPoint(null);
      setPreviewRect(null);
      setEditingHotspotId(newHotspot.id);
      return;
    }
  };

  const handleMapMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (mode === 'edit' && editFirstPoint) {
      const point = getClickPercent(event);
      setPreviewRect({
        x: Math.min(editFirstPoint.x, point.x),
        y: Math.min(editFirstPoint.y, point.y),
        w: Math.abs(editFirstPoint.x - point.x),
        h: Math.abs(editFirstPoint.y - point.y),
      });
    }
  };

  const handleHotspotClick = (hotspot: WorldMapHotspot) => {
    if (mode === 'edit') {
      setEditingHotspotId(hotspot.id === editingHotspotId ? null : hotspot.id);
      return;
    }
    if (mode === 'view' && hotspot.targetMapId && atlas.maps[hotspot.targetMapId]) {
      setCurrentMapId(hotspot.targetMapId);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setHelperFirstPoint(null);
    setHelperResult('');
    setEditFirstPoint(null);
    setPreviewRect(null);
    if (next !== 'edit') setEditingHotspotId(null);
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderMapImage = () => {
    if (currentMap.imageUrl) {
      return (
        <img
          src={currentMap.imageUrl}
          alt={currentMap.title}
          className="block w-full select-none"
          draggable={false}
        />
      );
    }
    return (
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(245,158,11,0.18),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.12),transparent_34%),linear-gradient(135deg,#2b2117,#0f172a_55%,#1c1917)]">
        <div className="absolute inset-0 opacity-30 bg-[repeating-linear-gradient(0deg,transparent,transparent_34px,rgba(251,191,36,0.18)_35px),repeating-linear-gradient(90deg,transparent,transparent_34px,rgba(251,191,36,0.14)_35px)]" />
        <div className="absolute inset-8 rounded-[2rem] border border-amber-700/30" />
        <div className="absolute left-[12%] top-[18%] h-[34%] w-[26%] rounded-full bg-emerald-900/35 blur-sm" />
        <div className="absolute right-[15%] top-[34%] h-[26%] w-[31%] rounded-full bg-amber-900/30 blur-sm" />
        <div className="absolute bottom-[13%] left-[35%] h-[18%] w-[40%] rounded-full bg-blue-950/40 blur-sm" />
        <div className="absolute inset-0 flex items-center justify-center text-center">
          <div className="rounded-2xl border border-amber-700/40 bg-black/40 px-8 py-6 backdrop-blur-sm">
            <Map className="mx-auto mb-3 h-10 w-10 text-amber-400" />
            <p className="text-2xl font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>
              {currentMap.title}
            </p>
            <p className="mt-2 max-w-md text-sm text-amber-100/70">
              Set <code>imageUrl</code> in your atlas JSON, or import a map atlas. Drop your image in <code>public/maps/</code>.
            </p>
          </div>
        </div>
      </div>
    );
  };

  const cursorClass = mode === 'view' ? '' : 'cursor-crosshair';

  return (
    <div className="w-full space-y-4">
      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-amber-800/40 bg-stone-950/50 p-5 shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>
              🗺️ World Map
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-amber-100/60">
              Navigate nested fantasy maps. Use <strong>Edit Mode</strong> to draw hotspots directly on the image.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Show / Hide */}
            <button
              onClick={() => setShowHotspots((v) => !v)}
              className="flex items-center gap-1.5 rounded border border-amber-700/40 bg-amber-950/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/50"
            >
              {showHotspots ? <EyeOff size={15} /> : <Eye size={15} />}
              {showHotspots ? 'Hide' : 'Show'}
            </button>

            {/* Coordinate Helper */}
            <button
              onClick={() => switchMode(mode === 'coordinate-helper' ? 'view' : 'coordinate-helper')}
              className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm ${mode === 'coordinate-helper' ? 'border-sky-400/60 bg-sky-950/60 text-sky-100' : 'border-sky-700/40 bg-sky-950/30 text-sky-300 hover:bg-sky-900/40'}`}
            >
              <Crosshair size={15} /> Coord Helper
            </button>

            {/* Edit Mode */}
            <button
              onClick={() => switchMode(mode === 'edit' ? 'view' : 'edit')}
              className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-bold ${mode === 'edit' ? 'border-emerald-400/60 bg-emerald-950/60 text-emerald-100' : 'border-emerald-700/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40'}`}
            >
              <Pencil size={15} /> {mode === 'edit' ? 'Editing' : 'Edit Mode'}
            </button>

            {/* Export / Import */}
            <button
              onClick={exportAtlas}
              className="flex items-center gap-1.5 rounded border border-stone-600/50 bg-stone-800/60 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-700/60"
            >
              <Download size={15} /> Export
            </button>
            <button
              onClick={resetAtlas}
              className="flex items-center gap-1.5 rounded border border-red-800/50 bg-red-950/40 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/50"
              title="Clear browser-saved world map edits"
            >
              <RefreshCw size={15} /> Refresh
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 rounded border border-stone-600/50 bg-stone-800/60 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-700/60">
              <Upload size={15} /> Import
              <input type="file" accept="application/json,.json" className="hidden" onChange={importAtlas} />
            </label>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {path.map((id, index) => {
            const node = atlas.maps[id];
            if (!node) return null;
            return (
              <React.Fragment key={id}>
                <button
                  onClick={() => setCurrentMapId(id)}
                  className={`rounded px-2 py-0.5 transition-colors ${id === currentMapId ? 'bg-amber-900/50 text-amber-200' : 'text-amber-500/70 hover:text-amber-200'}`}
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  {node.title}
                </button>
                {index < path.length - 1 && <span className="text-amber-800/60">›</span>}
              </React.Fragment>
            );
          })}
        </div>

        {path.length > 1 && (
          <button
            onClick={() => setCurrentMapId(path[path.length - 2])}
            className="mt-2 flex items-center gap-1.5 text-sm text-amber-600 hover:text-amber-300"
          >
            <ArrowLeft size={14} /> Back to {atlas.maps[path[path.length - 2]]?.title}
          </button>
        )}
      </div>

      {/* ── Mode info banners ────────────────────────────────────────────────── */}
      {mode === 'coordinate-helper' && (
        <div className="rounded-xl border border-sky-700/40 bg-sky-950/20 p-4 text-sm text-sky-100">
          <p className="font-bold">Coordinate Helper — click two corners to measure a region.</p>
          <p className="mt-1 text-sky-100/70">Output is <code className="rounded bg-black/30 px-1">x, y, w, h</code> percentages ready to paste into your atlas JSON.</p>
          {helperResult && (
            <div className="mt-3 flex items-start gap-3">
              <pre className="max-w-xs overflow-auto rounded bg-black/40 p-3 text-xs text-sky-200">{helperResult}</pre>
              <button
                onClick={() => navigator.clipboard.writeText(helperResult)}
                className="flex items-center gap-1.5 rounded border border-sky-700/40 bg-sky-900/40 px-2 py-1.5 text-xs hover:bg-sky-800/40"
              >
                <Copy size={13} /> Copy
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 text-sm text-emerald-100">
          <p className="font-bold" style={{ fontFamily: "'Cinzel', serif" }}>
            Edit Mode — click two corners on the map to draw a new hotspot.
          </p>
          <p className="mt-1 text-emerald-100/70">
            After placing a hotspot, rename it in the right panel, choose a color, and optionally enable <strong>Nested</strong> to create a child map behind it.
            All changes are saved to browser storage. Export the atlas JSON to make them permanent.
          </p>
          {editFirstPoint && (
            <p className="mt-2 text-emerald-300">
              ✦ First corner placed at {editFirstPoint.x}%, {editFirstPoint.y}%. Click the opposite corner.
            </p>
          )}
        </div>
      )}

      {/* ── Map + Sidebar grid ───────────────────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Map canvas ──────────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-amber-800/40 bg-black/30 p-3 shadow-2xl">
          <div
            className={`relative overflow-hidden rounded-xl border border-amber-900/40 select-none ${cursorClass}`}
            onClick={handleMapClick}
            onMouseMove={handleMapMouseMove}
          >
            {renderMapImage()}

            {/* Existing hotspots */}
            {showHotspots && currentMap.hotspots.map((hotspot) => {
              const isBeingEdited = editingHotspotId === hotspot.id;
              const color = hotspot.color ?? '#f59e0b';
              const hasChild = !!hotspot.targetMapId && !!atlas.maps[hotspot.targetMapId];

              return (
                <button
                  key={hotspot.id}
                  onClick={(e) => { e.stopPropagation(); handleHotspotClick(hotspot); }}
                  className={`absolute rounded-lg border-2 bg-black/25 backdrop-blur-[1px] transition-all focus:outline-none ${
                    mode === 'view' && hasChild ? 'hover:scale-[1.02] hover:bg-black/45 cursor-pointer' : ''
                  } ${mode === 'edit' ? 'cursor-pointer' : ''} ${isBeingEdited ? 'ring-2 ring-white/70 scale-[1.02]' : ''}`}
                  style={{
                    left: `${hotspot.x}%`,
                    top: `${hotspot.y}%`,
                    width: `${hotspot.w}%`,
                    height: `${hotspot.h}%`,
                    borderColor: color,
                    borderStyle: mode === 'edit' ? 'solid' : 'dashed',
                    boxShadow: `0 0 ${isBeingEdited ? '28px' : '14px'} ${color}${isBeingEdited ? '88' : '44'}`,
                  }}
                  title={hotspot.description ?? hotspot.label}
                >
                  <span
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-stone-950/90 px-2 py-0.5 text-xs font-bold pointer-events-none"
                    style={{ color, borderColor: `${color}55`, fontFamily: "'Cinzel', serif" }}
                  >
                    {hotspot.label}
                    {hasChild && ' ›'}
                  </span>
                  {mode === 'edit' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteHotspot(hotspot.id); }}
                      className="absolute right-1 top-1 rounded-full bg-red-950/80 p-0.5 text-red-300 hover:bg-red-800/80 opacity-0 hover:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  )}
                </button>
              );
            })}

            {/* Preview rect while drawing */}
            {mode === 'edit' && previewRect && previewRect.w > 0.5 && previewRect.h > 0.5 && (
              <div
                className="pointer-events-none absolute rounded-lg border-2 border-dashed border-emerald-400/80 bg-emerald-500/10"
                style={{
                  left: `${previewRect.x}%`,
                  top: `${previewRect.y}%`,
                  width: `${previewRect.w}%`,
                  height: `${previewRect.h}%`,
                }}
              />
            )}

            {/* First-click dot for both modes */}
            {(mode === 'coordinate-helper' && helperFirstPoint) && (
              <div
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-200 bg-sky-500 shadow-[0_0_16px_rgba(56,189,248,0.8)]"
                style={{ left: `${helperFirstPoint.x}%`, top: `${helperFirstPoint.y}%` }}
              />
            )}
            {(mode === 'edit' && editFirstPoint) && (
              <div
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-200 bg-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.8)]"
                style={{ left: `${editFirstPoint.x}%`, top: `${editFirstPoint.y}%` }}
              />
            )}
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
        <aside className="space-y-4">
          {/* Map info / edit */}
          <div className="rounded-2xl border border-amber-800/40 bg-stone-950/50 p-5 shadow-xl">
            {mode === 'edit' ? (
              <>
                <p className="mb-3 text-xs uppercase tracking-widest text-emerald-500" style={{ fontFamily: "'Cinzel', serif" }}>
                  Editing: {currentMap.title}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Map Title</label>
                    <input
                      value={currentMap.title}
                      onChange={(e) => patchCurrentMap({ title: e.target.value })}
                      className="w-full rounded bg-stone-900 border border-stone-700 px-3 py-1.5 text-sm text-amber-100 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Subtitle</label>
                    <input
                      value={currentMap.subtitle ?? ''}
                      onChange={(e) => patchCurrentMap({ subtitle: e.target.value })}
                      className="w-full rounded bg-stone-900 border border-stone-700 px-3 py-1.5 text-sm text-amber-100 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Image URL</label>
                    <input
                      value={currentMap.imageUrl ?? ''}
                      onChange={(e) => patchCurrentMap({ imageUrl: e.target.value })}
                      placeholder="/maps/world.jpg"
                      className="w-full rounded bg-stone-900 border border-stone-700 px-3 py-1.5 text-sm text-amber-100 font-mono focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Description</label>
                    <textarea
                      value={currentMap.description ?? ''}
                      onChange={(e) => patchCurrentMap({ description: e.target.value })}
                      rows={2}
                      className="w-full rounded bg-stone-900 border border-stone-700 px-3 py-1.5 text-sm text-amber-100 focus:outline-none focus:border-emerald-500/50 resize-none"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                  {currentMap.title}
                </h3>
                {currentMap.subtitle && <p className="mt-1 text-sm italic text-amber-600">{currentMap.subtitle}</p>}
                {currentMap.description && <p className="mt-3 text-sm leading-relaxed text-amber-100/70">{currentMap.description}</p>}
              </>
            )}
          </div>

          {/* Hotspot editor (edit mode) */}
          {mode === 'edit' && (
            <div className="rounded-2xl border border-emerald-800/30 bg-stone-950/50 p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs uppercase tracking-widest text-emerald-500" style={{ fontFamily: "'Cinzel', serif" }}>
                  Hotspots ({currentMap.hotspots.length})
                </p>
                <p className="text-xs text-stone-500">Click map to draw a new one</p>
              </div>

              {currentMap.hotspots.length === 0 ? (
                <p className="text-sm italic text-stone-600">No hotspots yet. Click two corners on the map to place one.</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {currentMap.hotspots.map((hotspot) => {
                    const isExpanded = editingHotspotId === hotspot.id;
                    const hasChild = !!hotspot.targetMapId && !!atlas.maps[hotspot.targetMapId];
                    const color = hotspot.color ?? '#f59e0b';

                    return (
                      <div
                        key={hotspot.id}
                        className={`rounded-lg border p-3 transition-all ${isExpanded ? 'border-emerald-600/60 bg-emerald-950/30' : 'border-stone-700/50 bg-black/20'}`}
                      >
                        {/* Row header */}
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <button
                            className="flex-1 text-left text-sm font-bold text-amber-200 truncate hover:text-amber-100"
                            style={{ fontFamily: "'Cinzel', serif" }}
                            onClick={() => setEditingHotspotId(isExpanded ? null : hotspot.id)}
                          >
                            {hotspot.label}
                            {hasChild && <span className="ml-1 text-emerald-400 text-xs">›</span>}
                          </button>
                          <button
                            onClick={() => deleteHotspot(hotspot.id)}
                            className="flex-shrink-0 text-red-500/50 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Expanded editor */}
                        {isExpanded && (
                          <div className="mt-3 space-y-2 border-t border-stone-700/40 pt-3">
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">Label</label>
                              <input
                                value={hotspot.label}
                                onChange={(e) => updateHotspot(hotspot.id, { label: e.target.value })}
                                className="w-full rounded bg-stone-900 border border-stone-700 px-2 py-1 text-sm text-amber-100 focus:outline-none focus:border-emerald-500/50"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">ID</label>
                              <input
                                value={hotspot.id}
                                onChange={(e) => {
                                  const newId = e.target.value.replace(/[^a-z0-9_-]/gi, '_');
                                  // update references in child maps too
                                  const oldId = hotspot.id;
                                  const updatedHotspots = currentMap.hotspots.map((h) =>
                                    h.id === oldId ? { ...h, id: newId } : h
                                  );
                                  patchCurrentMap({ hotspots: updatedHotspots });
                                  setEditingHotspotId(newId);
                                }}
                                className="w-full rounded bg-stone-900 border border-stone-700 px-2 py-1 text-sm text-emerald-200 font-mono focus:outline-none focus:border-emerald-500/50"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">Description</label>
                              <input
                                value={hotspot.description ?? ''}
                                onChange={(e) => updateHotspot(hotspot.id, { description: e.target.value })}
                                className="w-full rounded bg-stone-900 border border-stone-700 px-2 py-1 text-sm text-amber-100 focus:outline-none focus:border-emerald-500/50"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">Color</label>
                              <div className="flex gap-1.5 flex-wrap">
                                {HOTSPOT_COLORS.map((c) => (
                                  <button
                                    key={c}
                                    onClick={() => updateHotspot(hotspot.id, { color: c })}
                                    className={`h-6 w-6 rounded-full border-2 transition-all ${hotspot.color === c ? 'scale-125 border-white' : 'border-transparent hover:border-white/50'}`}
                                    style={{ backgroundColor: c }}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* Nested toggle */}
                            <div className="rounded-lg border border-stone-700/50 bg-black/20 p-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-bold text-amber-200">Nested Map</p>
                                  <p className="text-xs text-stone-500">
                                    {hasChild
                                      ? `Links to: ${atlas.maps[hotspot.targetMapId]?.title ?? hotspot.targetMapId}`
                                      : 'Clicking this hotspot does nothing yet.'}
                                  </p>
                                </div>
                                {hasChild ? (
                                  <button
                                    onClick={() => removeNested(hotspot)}
                                    className="flex items-center gap-1 rounded border border-red-700/40 bg-red-950/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/40"
                                  >
                                    <X size={12} /> Unlink
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => makeNested(hotspot)}
                                    className="flex items-center gap-1 rounded border border-emerald-700/40 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40"
                                  >
                                    <Plus size={12} /> Create Child Map
                                  </button>
                                )}
                              </div>
                              {hasChild && (
                                <button
                                  onClick={() => setCurrentMapId(hotspot.targetMapId)}
                                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-emerald-700/30 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/40"
                                >
                                  <Pencil size={12} /> Edit Child Map
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* View mode: location list */}
          {mode === 'view' && (
            <div className="rounded-2xl border border-amber-800/40 bg-stone-950/50 p-5 shadow-xl">
              <p className="mb-3 text-xs uppercase tracking-widest text-amber-700" style={{ fontFamily: "'Cinzel', serif" }}>
                Clickable Locations
              </p>
              {currentMap.hotspots.length === 0 ? (
                <p className="text-sm italic text-stone-500">No points of interest on this map.</p>
              ) : (
                <div className="space-y-2">
                  {currentMap.hotspots.map((hotspot) => {
                    const hasChild = !!hotspot.targetMapId && !!atlas.maps[hotspot.targetMapId];
                    const color = hotspot.color ?? '#f59e0b';
                    return (
                      <button
                        key={hotspot.id}
                        onClick={() => { if (hasChild) setCurrentMapId(hotspot.targetMapId); }}
                        disabled={!hasChild}
                        className={`w-full rounded-lg border bg-black/25 p-3 text-left transition-colors ${hasChild ? 'border-amber-900/40 hover:border-amber-600/60 hover:bg-amber-950/25 cursor-pointer' : 'border-stone-800/40 opacity-60 cursor-default'}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <div className="font-bold text-amber-200 text-sm" style={{ fontFamily: "'Cinzel', serif" }}>
                            {hotspot.label} {hasChild ? '›' : ''}
                          </div>
                        </div>
                        {hotspot.description && (
                          <div className="mt-1 text-xs text-amber-100/50 pl-4">{hotspot.description}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default WorldMap;
