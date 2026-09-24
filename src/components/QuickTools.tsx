import React, { useEffect, useState } from 'react';
import { Check, ChevronLeft, Clock3, Plus, X } from 'lucide-react';
import { HomebrewEntryDialog } from './HomebrewEntryDialog';
import { CharacterData } from '../types/character';
import { loadCharacterById, updateCharacterFields } from '../lib/firestore';
import { applyCharacterTimeProgression, CharacterTimeAction } from '../lib/characterTime';
import { buildCharacterSheetSyncValues } from '../lib/characterContext';
import { DEFAULT_CHARACTER_SYNC_SHEET_ID, DEFAULT_CHARACTER_SYNC_TAB_NAME, syncCharacterSheet } from '../lib/characterSheetSync';
import { setCachedHomebrewCharacter } from '../lib/homebrewCharacterCache';

interface QuickToolsProps {
  character: CharacterData | null;
  canControl: boolean;
  onCharacterUpdated: (character: CharacterData) => void;
  userId?: string | null;
}

const proceedOptions: Array<{
  action: CharacterTimeAction;
  label: string;
  defaultMinutes?: number;
}> = [
  { action: 'short-rest', label: 'Short Rest' },
  { action: 'long-rest', label: 'Long Rest', defaultMinutes: 480 },
  { action: 'skip-minute', label: 'Skip Minute', defaultMinutes: 1 },
  { action: 'end-battle', label: 'End Battle' },
  { action: 'end-turn', label: 'End Turn' },
];

export const QuickTools: React.FC<QuickToolsProps> = ({
  character,
  canControl,
  onCharacterUpdated,
  userId = null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const notify = (event: Event) => { setNotice(String((event as CustomEvent).detail)); clearTimeout(timer); timer = setTimeout(() => setNotice(''), 10000); };
    window.addEventListener('homebrew-notice', notify);
    return () => { window.removeEventListener('homebrew-notice', notify); clearTimeout(timer); };
  }, []);
  const [minuteAction, setMinuteAction] = useState<typeof proceedOptions[number] | null>(null);
  const [minutesDraft, setMinutesDraft] = useState('1');
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const runAction = async (option: typeof proceedOptions[number], minutes?: number) => {
    if (!character || !canControl || isSaving) return;
    setIsSaving(true);
    setMessage(null);

    try {
      const freshCharacter = await loadCharacterById(character.id, userId);
      const baseCharacter = freshCharacter || character;
      const updatedCharacter = applyCharacterTimeProgression(baseCharacter, option.action, { minutes });
      setCachedHomebrewCharacter(updatedCharacter);
      onCharacterUpdated(updatedCharacter);
      const saveResult = await updateCharacterFields(updatedCharacter.id, userId, {
        bars: updatedCharacter.bars,
        statuses: updatedCharacter.statuses,
        inventory: updatedCharacter.inventory,
        generalItems: updatedCharacter.generalItems,
        spells: updatedCharacter.spells,
      });
      if (!saveResult.localSaved && !saveResult.remoteSaved) {
        setMessage('Could not save changes.');
        return;
      }
      if (updatedCharacter.sendToSpreadsheet ?? true) {
        const syncResult = await syncCharacterSheet({
          characterId: updatedCharacter.id,
          characterName: updatedCharacter.name,
          sheetId: DEFAULT_CHARACTER_SYNC_SHEET_ID,
          tabName: DEFAULT_CHARACTER_SYNC_TAB_NAME,
          values: buildCharacterSheetSyncValues(updatedCharacter),
        });
        setMessage(syncResult.success ? `${option.label} applied.` : `${option.label} applied. Spreadsheet: ${syncResult.message}`);
      } else {
        setMessage(`${option.label} applied.`);
      }
      setMinuteAction(null);
      setIsOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Proceed Time failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const selectOption = (option: typeof proceedOptions[number]) => {
    if (!option.defaultMinutes) {
      void runAction(option);
      return;
    }
    setMinuteAction(option);
    setMinutesDraft(String(option.defaultMinutes));
    setMessage(null);
  };

  const submitMinutes = () => {
    if (!minuteAction) return;
    const minutes = Number.parseFloat(minutesDraft.replace(',', '.'));
    if (!Number.isFinite(minutes) || minutes < 0) {
      setMessage('Please enter a valid minute amount.');
      return;
    }
    void runAction(minuteAction, minutes);
  };

  return (
    <>
      <aside className="fixed right-0 top-0 z-[9000] flex h-screen w-[70px] flex-col border-l border-amber-800/20 bg-[#170d08]/95 text-amber-100 shadow-[-12px_0_28px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        <div className="px-3 pt-5 text-[11px] font-bold uppercase leading-3 tracking-[0.22em] text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>
          Quick<br />Tools
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2">
          <button type="button" aria-label="Add" title={canControl ? 'Add' : 'Control permission required'} disabled={!character || !canControl || isSaving} onClick={() => setAdding(true)} className="group flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-amber-800/20 bg-amber-950/25 px-1 py-3 text-center transition hover:border-cyan-500/50 hover:bg-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-35"><Plus size={23} className="text-cyan-200" /><span className="text-[9px] font-bold uppercase leading-3 text-amber-100">Add</span></button>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            disabled={!character || !canControl || isSaving}
            className="group flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-amber-800/20 bg-amber-950/25 px-1 py-3 text-center transition hover:border-cyan-500/50 hover:bg-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-35"
            title={canControl ? 'Proceed Time' : 'Control permission required'}
          >
            <span className="text-lg font-black leading-none text-cyan-200" style={{ fontFamily: "'Cinzel', serif" }}>Zzz</span>
            <span className="text-[9px] font-bold uppercase leading-3 tracking-[0.08em] text-amber-100 group-hover:text-cyan-100">
              Proceed<br />Time
            </span>
          </button>
        </div>

        {!character || !canControl ? (
          <div className="mb-7 -rotate-90 whitespace-nowrap text-[11px] uppercase tracking-[0.16em] text-stone-500">
            {character ? 'No Access' : 'No Tools'}
          </div>
        ) : null}
      </aside>

      {adding && character && <HomebrewEntryDialog key={character.id} character={character} userId={userId} onUpdated={onCharacterUpdated} onClose={() => setAdding(false)} />}
      {notice && <div role="status" className="fixed bottom-5 right-[82px] z-[10001] flex w-[min(360px,calc(100vw-100px))] items-start gap-3 rounded-lg border border-emerald-700 bg-stone-950 p-4 text-sm text-emerald-100 shadow-xl"><span className="min-w-0 flex-1 break-words">{notice}</span><button type="button" aria-label="Dismiss notification" title="Dismiss" onClick={() => setNotice('')}><X size={16} /></button></div>}

      {isOpen && (
        <div className="fixed inset-0 z-[9100] bg-black/25" onClick={() => setIsOpen(false)}>
          <div
            className="absolute right-[82px] top-1/2 w-[min(360px,calc(100vw-110px))] -translate-y-1/2 rounded-2xl border border-amber-700/35 bg-stone-950 p-4 text-amber-100 shadow-[0_22px_60px_rgba(0,0,0,0.6)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-amber-900/35 pb-3">
              <div className="flex items-center gap-2">
                <Clock3 size={17} className="text-cyan-300" />
                <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
                  Proceed Time
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded border border-stone-700/70 p-1.5 text-stone-400 transition hover:border-stone-500 hover:text-stone-100"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              {proceedOptions.map((option) => (
                <button
                  key={option.action}
                  type="button"
                  onClick={() => selectOption(option)}
                  disabled={isSaving}
                  className="flex items-center justify-between rounded-xl border border-amber-900/35 bg-amber-950/20 px-3 py-2 text-left text-sm font-bold text-amber-100 transition hover:border-cyan-600/50 hover:bg-cyan-950/25 disabled:cursor-wait disabled:opacity-50"
                >
                  <span>{option.label}</span>
                  <ChevronLeft size={15} className="rotate-180 text-cyan-300/80" />
                </button>
              ))}
            </div>

            {minuteAction && (
              <div className="mt-4 rounded-xl border border-cyan-900/45 bg-cyan-950/20 p-3">
                <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">
                  Minutes for {minuteAction.label}
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={minutesDraft}
                    onChange={(event) => {
                      setMinutesDraft(event.target.value.replace(',', '.').replace(/[^\d.-]/g, ''));
                      setMessage(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitMinutes();
                      if (event.key === 'Escape') setMinuteAction(null);
                    }}
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm font-mono text-cyan-100 focus:border-cyan-500/70 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={submitMinutes}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/60 bg-cyan-900/40 px-3 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-800/55 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Check size={15} /> Apply
                  </button>
                </div>
              </div>
            )}

            {message && (
              <div className="mt-3 rounded-lg border border-amber-800/35 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
                {message}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
