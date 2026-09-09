import { CharacterData } from '../types/character';

const cache = new Map<string, CharacterData>();

export const getCachedHomebrewCharacter = (characterId: string): CharacterData | null => (
  cache.get(characterId) || null
);

export const setCachedHomebrewCharacter = (character: CharacterData | null | undefined) => {
  if (!character?.id) return;
  cache.set(character.id, character);
};
