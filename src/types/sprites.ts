export type SpriteAnimation = 'idle' | 'move' | 'attack' | 'cast' | 'hit' | 'dodge' | 'downed' | 'recover';
export interface SpriteSheet {
  url: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frames: number;
  fps: number;
  anchorX: number;
  anchorY: number;
  displayHeight: number;
}
export interface CharacterSprites {
  version: 1;
  preset: 'knight' | 'mage' | 'monster';
  clips: Partial<Record<SpriteAnimation, SpriteSheet>>;
}
