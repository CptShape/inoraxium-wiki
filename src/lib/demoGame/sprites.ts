import type { Combatant, SpritePreset } from './types';

export const SPRITES = {
  knight: { label: 'Knight', file: 'knight_m', width: 16, height: 28 },
  mage: { label: 'Mage', file: 'wizzard_m', width: 16, height: 28 },
  monster: { label: 'Monster', file: 'big_demon', width: 32, height: 36 },
} satisfies Record<SpritePreset, { label: string; file: string; width: number; height: number }>;

export function spriteFor(actor: Combatant): SpritePreset {
  if (actor.sprite && Object.prototype.hasOwnProperty.call(SPRITES, actor.sprite)) return actor.sprite;
  if (actor.character.sprites?.preset && Object.prototype.hasOwnProperty.call(SPRITES, actor.character.sprites.preset)) return actor.character.sprites.preset;
  // Old encounter saves have no appearance field; do not reset the session to migrate it.
  if (actor.sourceCharacterId === 'demo-sentinel') return 'monster';
  if (actor.sourceCharacterId === 'demo-arcanist' || /mage|wizard|sorcerer|warlock/i.test(actor.character.className || '')) return 'mage';
  return 'knight';
}

export const spriteFrame = (preset: SpritePreset, animation: 'idle' | 'run', frame: number) =>
  `${import.meta.env.BASE_URL}demo-game/sprites/${SPRITES[preset].file}_${animation}_anim_f${frame}.png`;
