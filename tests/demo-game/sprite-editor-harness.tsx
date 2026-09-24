import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CharacterSpritesEditor from '../../src/components/CharacterSpritesEditor';
import { defaultSpriteSheet } from '../../src/lib/characterSprites';
import type { CharacterSprites } from '../../src/types/sprites';

export function mountSpriteEditor() {
  function Harness() {
    const [value, setValue] = useState<CharacterSprites>({ version: 1, preset: 'knight', clips: { idle: { ...defaultSpriteSheet(), url: 'https://i.imgur.com/qa-sprite.png' } } });
    return <><button onClick={() => setValue({ version: 1, preset: 'monster', clips: {} })}>Reload profile</button><CharacterSpritesEditor value={value} disabled={false} onChange={setValue} /></>;
  }
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '10000', overflow: 'auto', background: '#172127', padding: '16px' });
  document.body.append(host);
  createRoot(host).render(<Harness />);
}
