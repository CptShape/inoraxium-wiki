import { useEffect, useRef, useState } from 'react';
import { Pencil, Send, RefreshCw } from 'lucide-react';
import type { CharacterData } from '../types/character';
import { addEntryToPartyInventory, loadPartiesForCharacterTransfer } from '../lib/firestore';
import { objectField, type HomebrewObject } from '../lib/homebrewEntries';
import { homebrewNotice } from '../lib/homebrewSaveFeedback';
import { HomebrewDialog } from './HomebrewDialog';
import { HomebrewEntryDialog } from './HomebrewEntryDialog';

export function HomebrewObjectTools({ character, entry, kind, userId, canControl, onUpdated }: { character: CharacterData; entry: HomebrewObject; kind: string; userId: string | null; canControl: boolean; onUpdated: (character: CharacterData) => void }) {
  const [editor, setEditor] = useState<HomebrewObject | null>(null);
  const [transfer, setTransfer] = useState<HomebrewObject | null>(null);
  return <span className="hb-object-tools">
    <button type="button" title="Edit" aria-label="Edit object" disabled={!canControl} onClick={() => setEditor(structuredClone(entry))}><Pencil size={18} /></button>
    <button type="button" title="Send to Party" aria-label="Send to Party" disabled={!canControl} onClick={() => setTransfer(structuredClone(entry))}><Send size={18} /></button>
    {editor && <HomebrewEntryDialog character={character} userId={userId} original={editor} field={objectField(kind)} onUpdated={onUpdated} onClose={() => setEditor(null)} />}
    {transfer && <SendToPartyDialog character={character} entry={transfer} kind={kind} userId={userId} onClose={() => setTransfer(null)} />}
  </span>;
}

function SendToPartyDialog({ character, entry, kind, userId, onClose }: { character: CharacterData; entry: HomebrewObject; kind: string; userId: string | null; onClose: () => void }) {
  const [options, setOptions] = useState<Awaited<ReturnType<typeof loadPartiesForCharacterTransfer>>>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError('');
    if (!userId || userId === 'guest') { setLoading(false); return; }
    void loadPartiesForCharacterTransfer(userId, character.id).then(result => { if (!disposed) setOptions(result); }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : 'Could not load parties.'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [userId, character.id, attempt]);
  const send = async (option: typeof options[number]) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await addEntryToPartyInventory(option.party, kind === 'spell' ? 'spell' : kind === 'status' ? 'status' : 'item', entry, character.id);
      homebrewNotice(`${entry.name} copied to ${option.party.name}.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send this object.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <HomebrewDialog title={`Send to Party: ${entry.name}`} onClose={onClose} busy={busy}>
    {error && <p role="alert" className="hb-error">{error}</p>}
    {loading ? <p role="status">Loading parties...</p> : !userId || userId === 'guest' ? <p>Sign in to send objects to a party.</p> : <>
      {!options.length && <p>No accessible parties include this character.</p>}
      <div className="hb-party-list">{options.map(option => <button key={option.party.id} type="button" disabled={busy} onClick={() => void send(option)}><span><strong>{option.party.name}</strong><small>{option.campaign.name}</small></span><Send size={18} /></button>)}</div>
      <button type="button" className="hb-secondary mt-4" disabled={busy} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16} />Refresh</button>
    </>}
  </HomebrewDialog>;
}
