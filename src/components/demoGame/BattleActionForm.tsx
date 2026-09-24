import { useState } from 'react';
import type { BattleSettings } from '../../types/battle';
import type { GameAction, Combatant } from '../../lib/demoGame/types';
import { defaultBattleSettings } from '../../lib/battleSettings';
import BattleSettingsEditor from '../BattleSettingsEditor';

export default function BattleActionForm({ action, bars, busy, onSave }: { action: GameAction; bars: Combatant['character']['bars']; busy: boolean; onSave: (settings: BattleSettings, effects: GameAction['effects']) => void }) {
  const [settings, setSettings] = useState(action.battleSettings || defaultBattleSettings());
  const [effects, setEffects] = useState(action.effects);
  return <form onSubmit={e => { e.preventDefault(); onSave(settings, effects); }}><BattleSettingsEditor bars={bars} expanded action={{ id: action.actionId || action.id, name: action.name, description: '', cost: '', usageRemaining: '', effects, battleSettings: settings }} disabled={busy} onChange={(next, imported) => { setSettings(next); if (imported) setEffects(imported); }} /><div className="dg-dialog-actions"><button type="submit" className="dg-primary" disabled={busy}>Save battle settings</button></div></form>;
}
