import { SPRITES, spriteFor } from '../../lib/demoGame/sprites';
import type { Combatant, SpritePreset } from '../../lib/demoGame/types';
import CharacterSprite from './CharacterSprite';

export default function SpritePicker({ actor }: { actor: Combatant }) {
  return <fieldset className="dg-sprite-picker"><legend>Battle sprite</legend><div>
    {(Object.keys(SPRITES) as SpritePreset[]).map(preset => <label key={preset}>
      <input type="radio" name="sprite" value={preset} defaultChecked={spriteFor(actor) === preset} />
      <svg viewBox="-52 -100 104 120" aria-hidden="true"><ellipse cy="3" rx="27" ry="10" fill="#121d16" /><CharacterSprite preset={preset} /></svg>
      <span>{SPRITES[preset].label}</span>
    </label>)}
  </div></fieldset>;
}
