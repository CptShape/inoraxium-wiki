import React, { useState, useEffect } from 'react';
import { ArrowDownAZ, ArrowUpZA, ChevronDown, ChevronUp, Plus, Trash2, Send } from 'lucide-react';
import {
  BATTLE_TRACKER_STORAGE_KEY_ACTIVE_INDEX,
  BATTLE_TRACKER_STORAGE_KEY_DESC,
  BATTLE_TRACKER_STORAGE_KEY_WEBHOOK,
  clearBattleTrackerCombatants,
  DEFAULT_BATTLE_TRACKER_COLUMNS,
  loadBattleTrackerRows,
  saveBattleTrackerRows,
} from '../lib/battleTracker';

// ─── Types ────────────────────────────────────────────────────────────────────

type Column = {
  id: string;
  name: string;
  isStatic?: boolean;
};

type Row = {
  id: string;
  cells: Record<string, string>;
  status?: 'fighting' | 'stunned' | 'unknown' | 'defeated';
};

const STORAGE_KEY_COLUMNS = 'battleTrackerColumns';
const STORAGE_KEY_ROWS = 'battleTrackerRows';
const STORAGE_KEY_ACTIVE_INDEX = BATTLE_TRACKER_STORAGE_KEY_ACTIVE_INDEX;
const STORAGE_KEY_WEBHOOK = BATTLE_TRACKER_STORAGE_KEY_WEBHOOK;
const STORAGE_KEY_DESC = BATTLE_TRACKER_STORAGE_KEY_DESC;

export const BattleTracker: React.FC = () => {
  // ─── State & Persistence ────────────────────────────────────────────────────
  
  const [columns, setColumns] = useState<Column[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_COLUMNS);
    return saved ? JSON.parse(saved) : DEFAULT_BATTLE_TRACKER_COLUMNS;
  });
  
  const [rows, setRows] = useState<Row[]>(() => {
    return loadBattleTrackerRows();
  });
  
  const [activeRowIndex, setActiveRowIndex] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_INDEX);
    return saved ? parseInt(saved, 10) : 0;
  });
  
  const [webhookUrl, setWebhookUrl] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_WEBHOOK) || '';
  });
  
  const [encounterDescription, setEncounterDescription] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_DESC) || '';
  });

  const [discordStatus, setDiscordStatus] = useState<string | null>(null);

  const [sortDesc, setSortDesc] = useState(true);

  // Auto-save changes to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLUMNS, JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    saveBattleTrackerRows(rows);
  }, [rows]);

  useEffect(() => {
    const syncRows = () => {
      setRows(loadBattleTrackerRows());
    };

    window.addEventListener('battle-tracker:rows-updated', syncRows as EventListener);
    return () => window.removeEventListener('battle-tracker:rows-updated', syncRows as EventListener);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ACTIVE_INDEX, activeRowIndex.toString());
  }, [activeRowIndex]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WEBHOOK, webhookUrl);
  }, [webhookUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DESC, encounterDescription);
  }, [encounterDescription]);

  // ─── Row/Turn Handlers ──────────────────────────────────────────────────────

  const nextTurn = () => {
    if (rows.length === 0) return;
    
    let nextIndex = activeRowIndex;
    let count = 0;
    
    // Find next combatant who is not Stunned or Defeated
    do {
      nextIndex = (nextIndex + 1) % rows.length;
      count++;
      
      // Safety break to prevent infinite loop if everyone is stunned/defeated
      if (count >= rows.length) {
        break;
      }
    } while (rows[nextIndex].status === 'stunned' || rows[nextIndex].status === 'defeated');
    
    setActiveRowIndex(nextIndex);
  };

  const addColumn = () => {
    const newColId = `col-${Date.now()}`;
    setColumns([...columns, { id: newColId, name: 'New Column' }]);
    
    setRows(rows.map(row => ({
      ...row,
      cells: { ...row.cells, [newColId]: '' }
    })));
  };

  const removeColumn = (colId: string) => {
    setColumns(columns.filter(c => c.id !== colId));
  };

  const updateColumnName = (colId: string, newName: string) => {
    setColumns(columns.map(c => c.id === colId ? { ...c, name: newName } : c));
  };

  const addRow = () => {
    const newRowId = `row-${Date.now()}`;
    const emptyCells: Record<string, string> = {};
    columns.forEach(c => {
      emptyCells[c.id] = '';
    });
    setRows([...rows, { id: newRowId, cells: emptyCells, status: 'fighting' }]);
  };

  const removeRow = (rowId: string) => {
    const removedIndex = rows.findIndex((r) => r.id === rowId);
    const nextRows = rows.filter(r => r.id !== rowId);
    setRows(nextRows);

    if (nextRows.length === 0) {
      setActiveRowIndex(0);
      return;
    }

    setActiveRowIndex((prev) => {
      if (removedIndex === -1) return Math.min(prev, nextRows.length - 1);
      if (prev > removedIndex) return prev - 1;
      if (prev === removedIndex) return Math.min(prev, nextRows.length - 1);
      return prev;
    });
  };

  const moveRow = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) return;

    const nextRows = [...rows];
    [nextRows[index], nextRows[targetIndex]] = [nextRows[targetIndex], nextRows[index]];
    setRows(nextRows);

    setActiveRowIndex((prev) => {
      if (prev === index) return targetIndex;
      if (prev === targetIndex) return index;
      return prev;
    });
  };

  const updateCell = (rowId: string, colId: string, value: string) => {
    setRows(rows.map(r => r.id === rowId ? {
      ...r,
      cells: { ...r.cells, [colId]: value }
    } : r));
  };

  const updateRowStatus = (rowId: string, status: Row['status']) => {
    setRows(rows.map(r => r.id === rowId ? { ...r, status } : r));
  };

  const sortRows = () => {
    const sorted = [...rows].sort((a, b) => {
      const aVal = parseInt(a.cells['initiative'] || '0', 10) || 0;
      const bVal = parseInt(b.cells['initiative'] || '0', 10) || 0;
      return sortDesc ? bVal - aVal : aVal - bVal;
    });
    setRows(sorted);
    setSortDesc(!sortDesc);
    setActiveRowIndex(0); // Reset turn to top when sorting
  };

  // ─── Discord Integration ────────────────────────────────────────────────────
  
  const getCombatantsPayload = () => rows.map((r) => ({
    name: r.cells['name'] || 'Unnamed Combatant',
    initiative: r.cells['initiative'] || '0',
    status: r.status ?? 'fighting',
  }));

  const sendEncounterMessage = async (type: 'start' | 'end') => {
    if (!webhookUrl || !webhookUrl.startsWith('http')) return;

    setDiscordStatus(type === 'start' ? 'Sending encounter start...' : 'Sending encounter end...');

    const endpointUrl = "https://ulunavir-vercel.vercel.app/api/send-encounter";

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl,
          type,
          description: encounterDescription,
          combatants: getCombatantsPayload(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setDiscordStatus(`Discord error: ${data.error || response.status}`);
        return;
      }

      setDiscordStatus(type === 'start' ? 'Encounter start sent.' : 'Encounter end sent.');
      setTimeout(() => setDiscordStatus(null), 2500);
    } catch (err) {
      console.error('Failed to send encounter to Discord:', err);
      setDiscordStatus('Failed to reach the serverless Discord endpoint.');
    }
  };

  const startEncounter = () => sendEncounterMessage('start');
  const endEncounter = () => sendEncounterMessage('end');

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full p-4 md:p-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-amber-900/30 pb-4">
        <div>
          <h1 
            className="text-4xl md:text-5xl font-bold text-amber-500 tracking-wider mb-2 drop-shadow-md"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            Battle Tracker
          </h1>
          <p 
            className="text-amber-200/70 text-lg italic"
            style={{ fontFamily: "'IM Fell English', serif" }}
          >
            Manage your encounters, track initiative, and control the chaos of battle.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={addColumn}
            className="flex items-center gap-2 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded-md hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-100 transition-all text-sm cursor-pointer shadow-md"
          >
            <Plus size={16} />
            <span>Add Column</span>
          </button>
          <button
            onClick={sortRows}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-900/40 border border-emerald-700/40 rounded-md hover:bg-emerald-900/60 hover:border-emerald-500/80 text-emerald-100 transition-all text-sm cursor-pointer shadow-md"
          >
            {sortDesc ? <ArrowDownAZ size={16} /> : <ArrowUpZA size={16} />}
            <span>Sort</span>
          </button>
          <button
            onClick={nextTurn}
            disabled={rows.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900/40 border border-blue-700/40 rounded-md hover:bg-blue-900/60 hover:border-blue-500/80 text-blue-100 disabled:opacity-25 disabled:cursor-not-allowed transition-all text-sm font-bold cursor-pointer shadow-md"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <span>Next Turn</span>
          </button>
          <button
            onClick={() => {
              clearBattleTrackerCombatants();
              setRows([]);
              setActiveRowIndex(0);
            }}
            disabled={rows.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-red-950/40 border border-red-800/40 rounded-md hover:bg-red-950/60 hover:border-red-500/80 text-red-100 disabled:opacity-25 disabled:cursor-not-allowed transition-all text-sm cursor-pointer shadow-md"
          >
            <Trash2 size={16} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* ─── Discord Integration ─────────────────────────────────────────────── */}
      <div className="mb-8 p-4 bg-indigo-900/10 border border-indigo-700/20 rounded-lg shadow-lg">
        <h3 className="text-lg text-indigo-300 mb-3 flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
          🔗 Discord Integration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-1.5 text-stone-200 text-sm font-mono focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Encounter Description</label>
            <input
              type="text"
              value={encounterDescription}
              onChange={e => setEncounterDescription(e.target.value)}
              placeholder="e.g., Goblin Ambush at the Crossroads"
              className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-1.5 text-amber-100 text-sm placeholder-stone-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <button
            onClick={startEncounter}
            disabled={!webhookUrl || rows.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-900/40 border border-indigo-700/50 rounded-md hover:bg-indigo-900/60 hover:border-indigo-500/80 text-indigo-100 disabled:opacity-25 disabled:cursor-not-allowed transition-all text-sm font-bold cursor-pointer shadow-md h-[34px] self-end"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <Send size={14} />
            <span>Start Encounter</span>
          </button>
          <button
            onClick={endEncounter}
            disabled={!webhookUrl || rows.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-red-950/40 border border-red-800/50 rounded-md hover:bg-red-950/60 hover:border-red-500/80 text-red-100 disabled:opacity-25 disabled:cursor-not-allowed transition-all text-sm font-bold cursor-pointer shadow-md h-[34px] self-end"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <Send size={14} />
            <span>End Encounter</span>
          </button>
        </div>
        {discordStatus && (
          <p className="mt-3 text-xs text-indigo-300/80" style={{ fontFamily: "'IM Fell English', serif" }}>
            {discordStatus}
          </p>
        )}
      </div>

      {/* ─── Battle Table ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto border border-amber-900/40 rounded-xl bg-black/30 backdrop-blur-sm shadow-xl custom-scrollbar mb-6">
        <table className="w-full text-left border-collapse table-fixed" style={{ minWidth: `${Math.max(columns.length * 200 + 160, 960)}px` }}>
          <thead>
            <tr className="bg-amber-950/80 border-b border-amber-700/40">
              {/* Status Header */}
              <th className="p-3 w-20 text-center text-amber-300 font-bold tracking-wide" style={{ fontFamily: "'Cinzel', serif" }}>
                Status
              </th>
              
              {/* Turn/Move Header */}
              <th className="p-3 w-20 text-center text-amber-300 font-bold tracking-wide" style={{ fontFamily: "'Cinzel', serif" }}>
                Turn
              </th>

              {/* Dynamic Headers */}
              {columns.map(col => (
                <th 
                  key={col.id} 
                  className="p-3 text-amber-300 font-bold tracking-wide relative group w-[200px]"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  <div className="flex items-center gap-2">
                    {col.isStatic ? (
                      <span className="py-1 px-2">{col.name}</span>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={col.name}
                          onChange={(e) => updateColumnName(col.id, e.target.value)}
                          className="bg-black/40 border border-amber-900/30 rounded px-2 py-1 text-amber-200 focus:outline-none focus:border-amber-500/40 w-full"
                        />
                        <button 
                          onClick={() => removeColumn(col.id)}
                          className="text-red-400/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Remove Column"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </th>
              ))}

              {/* Action Header */}
              <th className="p-3 w-20 text-center text-amber-300/60" style={{ fontFamily: "'Cinzel', serif" }}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td 
                  colSpan={columns.length + 3} 
                  className="p-12 text-center text-amber-600/40 italic text-lg"
                  style={{ fontFamily: "'IM Fell English', serif" }}
                >
                  No combatants recorded in the scroll. Click "Add Combatant" to begin.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const isCurrentTurn = index === activeRowIndex;
                const status = row.status ?? 'fighting';
                
                return (
                  <tr 
                    key={row.id} 
                    className={`
                      border-b border-amber-900/20 transition-all duration-300
                      ${isCurrentTurn 
                        ? 'bg-amber-900/30 shadow-[inset_0_0_20px_rgba(251,191,36,0.15)] ring-1 ring-inset ring-amber-500/40' 
                        : (index % 2 === 0 ? 'bg-black/20' : 'bg-black/40')}
                      ${status === 'defeated' ? 'opacity-40' : ''}
                      ${status === 'stunned' ? 'bg-indigo-950/10' : ''}
                    `}
                  >
                    {/* Status Cell - Dropdown */}
                    <td className="p-2 text-center align-middle">
                      <select
                        value={status}
                        onChange={(e) => updateRowStatus(row.id, e.target.value as Row['status'])}
                        className={`
                          bg-stone-900 border border-amber-800/40 rounded px-1.5 py-1 
                          text-lg focus:outline-none cursor-pointer text-center select-none
                          hover:border-amber-500/50 focus:border-amber-500/60 transition-all
                          ${status === 'stunned' ? 'shadow-[0_0_8px_rgba(167,139,250,0.2)] border-indigo-500/30' : ''}
                          ${status === 'defeated' ? 'border-red-900/30 grayscale' : ''}
                        `}
                        title={`Status: ${status}`}
                      >
                        <option value="fighting" title="Fighting">⚔️</option>
                        <option value="stunned" title="Stunned">⚡</option>
                        <option value="unknown" title="Unknown">❓</option>
                        <option value="defeated" title="Defeated">💀</option>
                      </select>
                    </td>

                    {/* Turn/Rearrange Cell */}
                    <td className="p-2 align-middle border-l border-r border-amber-900/10">
                      <div className="flex flex-col items-center justify-center gap-0.5">
                        {/* Move Up */}
                        <button
                          onClick={() => moveRow(index, 'up')}
                          disabled={index === 0}
                          className="p-0.5 text-amber-500/50 hover:text-amber-300 hover:bg-amber-900/20 rounded disabled:opacity-0 disabled:cursor-not-allowed transition-all cursor-pointer"
                          title="Move row up"
                        >
                          <ChevronUp size={14} />
                        </button>

                        {/* Turn Circle Indicator */}
                        <button
                          onClick={() => setActiveRowIndex(index)}
                          className="relative group p-0.5"
                          title={isCurrentTurn ? "Current Turn" : "Set to this turn"}
                        >
                          <span
                            className={`
                              block w-5 h-5 rounded-full border-2 transition-all duration-300
                              ${isCurrentTurn
                                ? 'border-amber-400 bg-amber-400 shadow-[inset_0_0_8px_rgba(0,0,0,0.5),0_0_12px_rgba(251,191,36,0.7)]'
                                : 'border-amber-600/60 bg-transparent hover:border-amber-400/80 hover:bg-amber-950/20'
                              }
                              ${status === 'defeated' && !isCurrentTurn ? 'border-stone-700' : ''}
                              ${status === 'stunned' && !isCurrentTurn ? 'border-indigo-500/40' : ''}
                            `}
                          />
                        </button>

                        {/* Move Down */}
                        <button
                          onClick={() => moveRow(index, 'down')}
                          disabled={index === rows.length - 1}
                          className="p-0.5 text-amber-500/50 hover:text-amber-300 hover:bg-amber-900/20 rounded disabled:opacity-0 disabled:cursor-not-allowed transition-all cursor-pointer"
                          title="Move row down"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </td>

                    {/* Editable Cells */}
                    {columns.map(col => (
                      <td key={`${row.id}-${col.id}`} className="p-2 w-[200px] border-r border-amber-900/10">
                        <input
                          type={col.id === 'initiative' ? 'number' : 'text'}
                          value={row.cells[col.id] || ''}
                          onChange={(e) => updateCell(row.id, col.id, e.target.value)}
                          placeholder={`Enter ${col.name.toLowerCase()}...`}
                          className={`
                            w-full bg-transparent border border-transparent hover:border-amber-900/40 
                            focus:bg-black/40 focus:border-amber-500/30 rounded px-2.5 py-1.5 
                            placeholder-stone-700 focus:outline-none transition-all
                            ${col.id === 'initiative' ? 'font-mono text-center font-bold' : ''}
                            ${isCurrentTurn ? 'text-amber-200' : 'text-amber-100/90'}
                            ${status === 'defeated' ? 'line-through text-stone-500' : ''}
                            ${status === 'stunned' ? 'text-indigo-200/70' : ''}
                          `}
                        />
                      </td>
                    ))}

                    {/* Remove Action Cell */}
                    <td className="p-2 text-center align-middle">
                      <button
                        onClick={() => removeRow(row.id)}
                        className="p-2 text-red-500/40 hover:text-red-400 hover:bg-red-950/20 rounded-lg transition-all cursor-pointer"
                        title="Remove combatant"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      
      {/* Add Row Button */}
      <div className="mt-4">
        <button
          onClick={addRow}
          className="flex items-center gap-2 px-6 py-3.5 bg-amber-950/40 border border-amber-800/40 rounded-xl hover:bg-amber-900/60 hover:border-amber-500/60 text-amber-300 hover:text-amber-200 transition-all w-full justify-center text-lg font-bold tracking-wide cursor-pointer shadow-md"
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          <Plus size={22} />
          <span>Add Combatant to Scroll</span>
        </button>
      </div>
    </div>
  );
};
export default BattleTracker;
