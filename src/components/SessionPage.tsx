import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Plus, Search, StickyNote, Users, Wrench, X } from 'lucide-react';
import { CharacterData, CharacterStatus } from '../types/character';
import { authProvider, AuthState } from '../lib/auth';
import { loadAdminAccess, loadCharacters, saveCharacter } from '../lib/firestore';
import Characters from './Characters';

type CharacterFilter = 'mine' | 'all';
type DmPanelTab = 'notes' | 'tools';

interface CharacterEntryExportPayload {
  schema: 'inoraxium-character-entry';
  version: 1;
  kind: 'item' | 'spell' | 'status' | 'macro' | 'script';
  entry: unknown;
}

const getRosterStorageKey = (uid: string | null) => `inoraxium-dm-tools-roster-${uid || 'guest'}`;
const getNotesStorageKey = (uid: string | null) => `inoraxium-dm-tools-notes-${uid || 'guest'}`;
const uid = () => Math.random().toString(36).slice(2, 10);

const normalizeImportedStatus = (entry: Partial<CharacterStatus> = {}): CharacterStatus => ({
  id: `st_${uid()}`,
  name: typeof entry.name === 'string' ? entry.name : 'Imported Status',
  duration: typeof entry.duration === 'string' ? entry.duration : '',
  durationType: entry.durationType || 'custom',
  durationEndBehavior: entry.durationEndBehavior || 'delete',
  maxDuration: typeof entry.maxDuration === 'string' ? entry.maxDuration : undefined,
  replenishTrigger: entry.replenishTrigger || 'custom',
  replenishAmount: typeof entry.replenishAmount === 'string' ? entry.replenishAmount : '',
  description: typeof entry.description === 'string' ? entry.description : '',
  effects: Array.isArray(entry.effects) ? entry.effects.map((effect) => ({ ...effect, id: effect.id || `eff_${uid()}` })) : [],
  actions: Array.isArray(entry.actions) ? entry.actions.map((action) => ({ ...action, id: action.id || `act_${uid()}` })) : [],
  localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map((variable) => ({ ...variable })) : [],
  active: entry.active ?? true,
  color: typeof entry.color === 'string' ? entry.color : '#22c55e',
  hidden: entry.hidden ?? false,
  folderId: typeof entry.folderId === 'string' ? entry.folderId : null,
});

const parseStatusExport = (raw: string): CharacterStatus => {
  const parsed = JSON.parse(raw) as CharacterEntryExportPayload | Partial<CharacterStatus>;
  if ('schema' in parsed) {
    if (parsed.schema !== 'inoraxium-character-entry' || parsed.version !== 1 || parsed.kind !== 'status' || !parsed.entry) {
      throw new Error('Clipboard/file does not contain a status export JSON.');
    }
    return normalizeImportedStatus(parsed.entry as Partial<CharacterStatus>);
  }
  return normalizeImportedStatus(parsed as Partial<CharacterStatus>);
};

const SessionPage: React.FC = () => {
  const [authState, setAuthState] = useState<AuthState>({ uid: null, displayName: null, email: null });
  const [isAdmin, setIsAdmin] = useState(false);
  const [availableCharacters, setAvailableCharacters] = useState<CharacterData[]>([]);
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CharacterFilter>('all');
  const [panelTab, setPanelTab] = useState<DmPanelTab>('notes');
  const [showAddCharacter, setShowAddCharacter] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [notesByCharacterId, setNotesByCharacterId] = useState<Record<string, string>>({});
  const [sheetRefreshKey, setSheetRefreshKey] = useState(0);
  const statusImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => authProvider.onAuthChange(setAuthState), []);

  useEffect(() => {
    let cancelled = false;
    loadAdminAccess(authState.uid, authState.email).then((access) => {
      if (!cancelled) setIsAdmin(access.isAdmin);
    });
    return () => {
      cancelled = true;
    };
  }, [authState.uid, authState.email]);

  useEffect(() => {
    const storedRoster = JSON.parse(localStorage.getItem(getRosterStorageKey(authState.uid)) || '[]') as string[];
    const storedNotes = JSON.parse(localStorage.getItem(getNotesStorageKey(authState.uid)) || '{}') as Record<string, string>;
    setRosterIds(Array.isArray(storedRoster) ? storedRoster : []);
    setNotesByCharacterId(storedNotes && typeof storedNotes === 'object' ? storedNotes : {});
  }, [authState.uid]);

  useEffect(() => {
    if (!authState.uid) return;
    loadCharacters(authState.uid, isAdmin)
      .then(setAvailableCharacters)
      .catch((error) => {
        console.error('Failed to load DM Tools characters:', error);
        setStatusMessage('Could not load characters.');
      });
  }, [authState.uid, isAdmin, sheetRefreshKey]);

  useEffect(() => {
    localStorage.setItem(getRosterStorageKey(authState.uid), JSON.stringify(rosterIds));
    if (!selectedCharacterId || !rosterIds.includes(selectedCharacterId)) {
      setSelectedCharacterId(rosterIds[0] || null);
    }
  }, [authState.uid, rosterIds, selectedCharacterId]);

  useEffect(() => {
    localStorage.setItem(getNotesStorageKey(authState.uid), JSON.stringify(notesByCharacterId));
  }, [authState.uid, notesByCharacterId]);

  const selectedCharacter = availableCharacters.find((character) => character.id === selectedCharacterId) || null;
  const rosterCharacters = useMemo(
    () => rosterIds
      .map((id) => availableCharacters.find((character) => character.id === id))
      .filter((character): character is CharacterData => !!character),
    [availableCharacters, rosterIds],
  );

  const addableCharacters = availableCharacters.filter((character) => (
    !rosterIds.includes(character.id)
    && (
      isAdmin
      || character.userId === authState.uid
      || !character.userId
      || (!!authState.uid && (character.controlUserIds || []).includes(authState.uid))
    )
  ));

  const visibleRosterCharacters = rosterCharacters.filter((character) => {
    if (filter === 'mine' && character.userId !== authState.uid) return false;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return [character.name, character.race, character.className].some((value) => (value || '').toLowerCase().includes(term));
  });

  const handleAddCharacter = (characterId: string) => {
    setRosterIds((current) => Array.from(new Set([...current, characterId])));
    setSelectedCharacterId(characterId);
    setShowAddCharacter(false);
    setStatusMessage('Character added to DM Tools.');
  };

  const handleRemoveCharacter = (characterId: string) => {
    setRosterIds((current) => current.filter((id) => id !== characterId));
    setStatusMessage('Character removed from DM Tools.');
  };

  const applyStatusToSelectedCharacter = async (status: CharacterStatus) => {
    if (!selectedCharacter) return;
    const updated: CharacterData = {
      ...selectedCharacter,
      statuses: [...(selectedCharacter.statuses || []), status],
    };
    const saveResult = await saveCharacter(updated);
    setAvailableCharacters((current) => current.map((character) => character.id === updated.id ? updated : character));
    setSheetRefreshKey((current) => current + 1);
    setStatusMessage(saveResult.remoteSaved
      ? `"${status.name}" applied to ${updated.name}.`
      : `"${status.name}" was added locally, but Firestore save failed.`);
  };

  const handleStatusFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await applyStatusToSelectedCharacter(parseStatusExport(await file.text()));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Status import failed.';
      window.alert(message);
      setStatusMessage(message);
    }
  };

  const handleAddStatus = async () => {
    if (!selectedCharacter) return;
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) {
        await applyStatusToSelectedCharacter(parseStatusExport(clipboardText));
        return;
      }
    } catch {
      // Clipboard can be blocked by browser permissions; file import is the fallback.
    }
    statusImportInputRef.current?.click();
  };

  const updateSelectedNotes = (value: string) => {
    if (!selectedCharacterId) return;
    setNotesByCharacterId((current) => ({
      ...current,
      [selectedCharacterId]: value,
    }));
  };

  return (
    <div className="relative min-h-[calc(100vh-120px)] overflow-hidden rounded-2xl border border-sky-900/40 bg-[#06111f] text-sky-50 shadow-2xl">
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(56,189,248,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.08)_1px,transparent_1px)] bg-[size:18px_18px]" />
      <input ref={statusImportInputRef} type="file" accept="application/json,.json" onChange={handleStatusFileSelected} className="hidden" />

      <div className="relative grid min-h-[calc(100vh-120px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-h-[720px] p-6 pb-48">
          <div className="mb-5 rounded-2xl border border-sky-800/35 bg-black/40 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80" style={{ fontFamily: "'Cinzel', serif" }}>Inoraxium Tools</p>
            <h2 className="mt-2 text-3xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>DM Tools</h2>
            <p className="mt-2 max-w-3xl text-sm text-sky-100/65">
              Add the characters you control, switch between them from the bottom rail, and edit their full character sheets without jumping back to the main character list.
            </p>
            {statusMessage && <p className="mt-3 text-sm text-sky-200/70">{statusMessage}</p>}
          </div>

          {selectedCharacterId ? (
            <Characters key={`${selectedCharacterId}-${sheetRefreshKey}`} embeddedMode embeddedCharacterId={selectedCharacterId} />
          ) : (
            <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-dashed border-sky-900/45 bg-black/20 p-8 text-center text-sky-100/45">
              <div>
                <Users className="mx-auto mb-3 text-cyan-300/50" size={42} />
                <p className="text-lg font-semibold text-sky-100/70" style={{ fontFamily: "'Cinzel', serif" }}>No Character Selected</p>
                <p className="mt-2 max-w-lg text-sm">Use Add Character from the bottom rail to build your DM control bar.</p>
              </div>
            </div>
          )}
        </main>

        <aside className="relative border-l border-sky-900/45 bg-black/35 p-5 pb-44">
          <div className="sticky top-4">
            <div className="mb-4 flex gap-2">
              {[
                { key: 'notes', label: 'Notes', icon: <StickyNote size={14} /> },
                { key: 'tools', label: 'Tools', icon: <Wrench size={14} /> },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setPanelTab(tab.key as DmPanelTab)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] ${panelTab === tab.key ? 'border-amber-400/70 bg-amber-950/40 text-amber-100' : 'border-sky-900/50 bg-black/30 text-sky-100/55 hover:text-sky-100'}`}
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {!selectedCharacter ? (
              <div className="rounded-2xl border border-sky-900/40 bg-black/30 p-6 text-sm text-sky-100/50">
                Select a character from the bottom rail.
              </div>
            ) : panelTab === 'notes' ? (
              <div className="rounded-2xl border border-sky-900/40 bg-black/30 p-4">
                <h3 className="mb-2 truncate text-lg font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{selectedCharacter.name} Notes</h3>
                <textarea
                  value={notesByCharacterId[selectedCharacter.id] || ''}
                  onChange={(event) => updateSelectedNotes(event.target.value)}
                  className="min-h-[420px] w-full resize-y rounded-xl border border-sky-900/55 bg-stone-950/70 p-3 text-sm text-sky-50 outline-none focus:border-cyan-400"
                  placeholder="Temporary DM notes, hidden conditions, reminders..."
                />
                <p className="mt-2 text-xs text-sky-100/40">Notes are saved locally in this browser for your DM account.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-sky-900/40 bg-black/30 p-4">
                <h3 className="mb-2 truncate text-lg font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{selectedCharacter.name} Tools</h3>
                <button
                  onClick={handleAddStatus}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-700/55 bg-emerald-950/35 px-4 py-3 text-sm font-bold text-emerald-100 hover:bg-emerald-900/45"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  <FileUp size={16} /> Add Status
                </button>
                <p className="mt-3 text-xs text-sky-100/45">
                  Tries the status JSON copied to your clipboard first. If the browser blocks clipboard access, it opens a JSON import picker.
                </p>
              </div>
            )}
          </div>
        </aside>

        <div className="absolute bottom-0 left-0 right-0 z-40 border-t border-sky-800/50 bg-[#020814]/95 shadow-[0_-18px_40px_rgba(8,47,73,0.45)] backdrop-blur lg:right-[360px]">
          <div className="border-b border-sky-900/50 px-4 py-2">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-300/60" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-lg border border-sky-900/60 bg-black/45 py-2 pl-9 pr-3 text-sm text-sky-50 outline-none focus:border-cyan-400"
                  placeholder="Search DM characters..."
                />
              </div>
              <button onClick={() => setFilter('mine')} className={`rounded-lg border px-3 py-2 text-xs ${filter === 'mine' ? 'border-amber-400/60 bg-amber-950/40 text-amber-100' : 'border-sky-900/50 text-sky-100/60'}`}>
                My Characters
              </button>
              <button onClick={() => setFilter('all')} className={`rounded-lg border px-3 py-2 text-xs ${filter === 'all' ? 'border-amber-400/60 bg-amber-950/40 text-amber-100' : 'border-sky-900/50 text-sky-100/60'}`}>
                All Characters
              </button>
              <button onClick={() => setShowAddCharacter(true)} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-900/40">
                <Plus size={14} /> Add Character
              </button>
            </div>
          </div>
          <div className="mx-auto flex max-w-[1600px] gap-3 overflow-x-auto px-4 py-4">
            {visibleRosterCharacters.length === 0 ? (
              <div className="rounded-xl border border-dashed border-sky-900/60 px-5 py-8 text-sm text-sky-100/45">No characters in DM Tools yet.</div>
            ) : visibleRosterCharacters.map((character) => (
              <div key={character.id} className="relative w-36 shrink-0">
                <button
                  onClick={() => setSelectedCharacterId(character.id)}
                  className={`w-full rounded-2xl border p-3 text-center transition ${selectedCharacterId === character.id ? 'border-amber-400/80 bg-amber-950/35 shadow-[0_0_18px_rgba(251,191,36,0.18)]' : 'border-sky-900/50 bg-black/35 hover:border-cyan-500/60'}`}
                >
                  <p className="mb-2 truncate text-sm font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{character.name}</p>
                  <div className="mx-auto h-20 w-20 overflow-hidden rounded-xl border border-sky-800/55 bg-stone-950">
                    {character.portraitUrl ? (
                      <img src={character.portraitUrl} alt={character.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center font-mono text-lg text-cyan-200">{character.name.slice(0, 2).toUpperCase()}</div>
                    )}
                  </div>
                </button>
                <button onClick={() => handleRemoveCharacter(character.id)} className="absolute right-1 top-1 rounded-full border border-red-700/40 bg-black/70 p-1 text-red-200 opacity-70 hover:opacity-100" title="Remove from DM Tools">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAddCharacter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-sky-800/45 bg-[#07111f] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Add Character</h3>
                <p className="text-sm text-sky-100/50">Choose a character you own or control{isAdmin ? ', or any admin-visible character' : ''}.</p>
              </div>
              <button onClick={() => setShowAddCharacter(false)} className="rounded-lg border border-sky-900/60 p-2 text-sky-100/70 hover:text-sky-100">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {addableCharacters.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sky-900/60 p-5 text-sm text-sky-100/45">No available characters to add.</p>
              ) : addableCharacters.map((character) => (
                <button key={character.id} onClick={() => handleAddCharacter(character.id)} className="flex w-full items-center gap-3 rounded-xl border border-sky-900/45 bg-black/30 p-3 text-left hover:border-cyan-500/55">
                  <div className="h-12 w-12 overflow-hidden rounded-lg border border-sky-800/55 bg-stone-950">
                    {character.portraitUrl ? (
                      <img src={character.portraitUrl} alt={character.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center font-mono text-sm text-cyan-200">{character.name.slice(0, 2).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-sky-100">{character.name}</p>
                    <p className="truncate text-xs text-sky-100/45">{character.race || 'Unknown race'} / {character.className || 'Unknown class'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionPage;
