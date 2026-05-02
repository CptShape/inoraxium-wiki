import React, { useState, useEffect } from 'react';
import { Plus, Star, Trash2, Save, ArrowLeft, Shield, Wand2, RefreshCw, Search, X, Filter, Settings } from 'lucide-react';
import { CharacterData, CustomAttribute, CharacterStatus, StatusEffect } from '../types/character';

function evalCharFormula(formula: string, context: Record<string, number>): number {
  if (!formula) return 0;
  
  let expr = formula.replace(/@([a-zA-Z0-9_-]+)/g, (match, refId) => {
    return (context[refId] ?? 0).toString();
  });

  expr = expr.replace(/roundup/g, 'Math.ceil')
             .replace(/rounddown/g, 'Math.floor')
             .replace(/round/g, 'Math.round')
             .replace(/max/g, 'Math.max')
             .replace(/min/g, 'Math.min');

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}
import { loadCharacters, saveCharacter, deleteCharacterFromDB, loadFavorites, toggleFavorite as toggleFavoriteDB } from '../lib/firestore';
import { authProvider } from '../lib/auth';

export const Characters: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<CharacterData[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterData | null>(null);
  const [isViewingSheet, setIsViewingSheet] = useState(false);

  // Filtering
  const [searchName, setSearchName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showOnlyFavs, setShowOnlyFavs] = useState(false);

  // Edit states
  const [editLevel, setEditLevel] = useState(1);
  const [editName, setEditName] = useState('');
  const [editRace, setEditRace] = useState('');
  const [editClass, setEditClass] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'public'>('private');
  const [attributes, setAttributes] = useState<Record<string, number>>({ STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 });
  const [bio, setBio] = useState('');
  const [charTags, setCharTags] = useState<string[]>([]);
  const [charTagInput, setCharTagInput] = useState('');
  
  const [mainAttrs, setMainAttrs] = useState<CustomAttribute[]>([]);
  const [secondaryAttrs, setSecondaryAttrs] = useState<CustomAttribute[]>([]);
  const [charStatuses, setCharStatuses] = useState<CharacterStatus[]>([]);
  const [modFormula, setModFormula] = useState<string>('rounddown((@value - 10) / 2)');
  const [showModOptions, setShowModOptions] = useState<boolean>(false);

  // ── Auth & Data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return authProvider.onAuthChange((state) => setUserId(state.uid));
  }, []);

  const fetchAll = async () => {
    const chars = await loadCharacters(userId);
    setCharacters(chars);
    const favs = await loadFavorites(userId);
    setFavoriteIds(favs);
    if (chars.length > 0 && !selectedCharacter) setSelectedCharacter(chars[0]);
  };

  useEffect(() => { fetchAll(); }, [userId]);

  useEffect(() => {
    let next = [...characters];
    if (searchName.trim()) next = next.filter(c => c.name.toLowerCase().includes(searchName.toLowerCase()));
    if (showOnlyFavs) next = next.filter(c => favoriteIds.includes(c.id));
    if (filterTags.length > 0) {
      next = next.filter(c => {
        const t = `${c.race} ${c.className} ${(c.tags || []).join(' ')}`.toLowerCase();
        return filterTags.every(tag => t.includes(tag.toLowerCase()));
      });
    }
    setFilteredCharacters(next);
  }, [characters, showOnlyFavs, favoriteIds]);

  useEffect(() => {
    if (selectedCharacter) {
      setEditLevel(selectedCharacter.level);
      setEditName(selectedCharacter.name);
      setEditRace(selectedCharacter.race);
      setEditClass(selectedCharacter.className);
      setEditVisibility(selectedCharacter.visibility ?? 'private');
      setAttributes(selectedCharacter.attributes || { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 });
      setBio(selectedCharacter.bio || '');
      setCharTags(selectedCharacter.tags || []);
      setMainAttrs(selectedCharacter.mainAttributes || []);
      setSecondaryAttrs(selectedCharacter.secondaryAttributes || []);
      setCharStatuses(selectedCharacter.statuses || []);
      setModFormula(selectedCharacter.modifierFormula || 'Math.floor((@value - 10) / 2)');
    }
  }, [selectedCharacter]);

  const getCharacterContext = () => {
    const context: Record<string, number> = {
      level: editLevel,
    };

    const mainAttrIds = (mainAttrs || []).map(a => a.id).filter(Boolean);
    const secAttrIds = (secondaryAttrs || []).map(a => a.id).filter(Boolean);

    // 1. Evaluate base values of main attributes
    (mainAttrs || []).forEach(attr => {
      if (attr.id) {
        context[attr.id] = evalCharFormula(attr.value || '0', context);
      }
    });

    // 2. Apply status effects targeting main attributes
    (charStatuses || []).forEach(status => {
      (status.effects || []).forEach(effect => {
        if (effect.targetId && mainAttrIds.includes(effect.targetId)) {
          const effVal = evalCharFormula(effect.value || '0', context);
          context[effect.targetId] = (context[effect.targetId] || 0) + effVal;
        }
      });
    });

    // 3. Evaluate main attribute modifiers based on updated main attributes
    (mainAttrs || []).forEach(attr => {
      if (attr.id) {
        const val = context[attr.id] || 0;
        const formula = (modFormula || 'Math.floor((@value - 10) / 2)').replace(/@value/g, val.toString());
        context[`${attr.id}_mod`] = evalCharFormula(formula, context);
      }
    });

    // 4. Apply status effects targeting modifiers
    (charStatuses || []).forEach(status => {
      (status.effects || []).forEach(effect => {
        const isModId = effect.targetId && mainAttrIds.some(mid => effect.targetId === `${mid}_mod`);
        if (isModId) {
          const effVal = evalCharFormula(effect.value || '0', context);
          context[effect.targetId] = (context[effect.targetId] || 0) + effVal;
        }
      });
    });

    // 5. Evaluate secondary attributes with final main attributes & modifiers
    (secondaryAttrs || []).forEach(attr => {
      if (attr.id) {
        context[attr.id] = evalCharFormula(attr.value || '0', context);
      }
    });

    // 6. Apply status effects targeting secondary attributes
    (charStatuses || []).forEach(status => {
      (status.effects || []).forEach(effect => {
        if (effect.targetId && secAttrIds.includes(effect.targetId)) {
          const effVal = evalCharFormula(effect.value || '0', context);
          context[effect.targetId] = (context[effect.targetId] || 0) + effVal;
        }
      });
    });

    return context;
  };

  // ── Filtering ────────────────────────────────────────────────────────────────

  const applyFilters = () => {
    let next = [...characters];
    if (searchName.trim()) next = next.filter(c => c.name.toLowerCase().includes(searchName.toLowerCase()));
    if (showOnlyFavs) next = next.filter(c => favoriteIds.includes(c.id));
    if (filterTags.length > 0) {
      next = next.filter(c => {
        const t = `${c.race} ${c.className} ${(c.tags || []).join(' ')}`.toLowerCase();
        return filterTags.every(tag => t.includes(tag.toLowerCase()));
      });
    }
    setFilteredCharacters(next);
  };

  const clearFilters = () => {
    setSearchName('');
    setTagInput('');
    setFilterTags([]);
    setShowOnlyFavs(false);
    setFilteredCharacters(characters);
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!filterTags.includes(tagInput.trim())) setFilterTags([...filterTags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => setFilterTags(filterTags.filter(t => t !== tag));

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    const id = `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newChar: CharacterData = {
      id,
      name: 'New Hero',
      level: 1,
      race: 'Human',
      className: 'Vanguard',
      visibility: 'private',
      userId: userId || 'guest',
      attributes: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      bio: '',
      createdAt: Date.now(),
    };
    await saveCharacter(newChar);
    setCharacters([...characters, newChar]);
    setSelectedCharacter(newChar);
  };

  const handleSavePreview = async () => {
    if (!selectedCharacter) return;
    const updated: CharacterData = {
      ...selectedCharacter,
      level: editLevel,
      name: editName.trim() || selectedCharacter.name,
      race: editRace.trim() || selectedCharacter.race,
      className: editClass.trim() || selectedCharacter.className,
      visibility: editVisibility,
      attributes,
      bio,
      tags: charTags,
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      statuses: charStatuses,
      modifierFormula: modFormula,
    };
    await saveCharacter(updated);
    setCharacters(characters.map(c => (c.id === updated.id ? updated : c)));
    setSelectedCharacter(updated);
  };

  const handleToggleFav = async (e: React.MouseEvent, charId: string) => {
    e.stopPropagation();
    const isFav = favoriteIds.includes(charId);
    const isNowFav = await toggleFavoriteDB(userId, charId, isFav);
    setFavoriteIds(prev => (isNowFav ? [...prev, charId] : prev.filter(id => id !== charId)));
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this character permanently?')) return;
    await deleteCharacterFromDB(id);
    const next = characters.filter(c => c.id !== id);
    setCharacters(next);
    setFavoriteIds(favoriteIds.filter(f => f !== id));
    if (selectedCharacter?.id === id) setSelectedCharacter(next[0] || null);
  };

  // ── Full Character Sheet ─────────────────────────────────────────────────────

  if (isViewingSheet && selectedCharacter) {
    return (
      <div className="w-full bg-stone-900/50 p-6 rounded-2xl border border-amber-800/40 shadow-xl animate-fade-in" style={{ fontFamily: "'IM Fell English', serif" }}>
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-amber-800/40">
          <button onClick={() => setIsViewingSheet(false)} className="flex items-center gap-2 text-amber-500 hover:text-amber-300 font-bold tracking-wider cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>
            <ArrowLeft size={20} /> Back to List
          </button>
          <div className="flex gap-3">
            {/* Visibility dropdown — only owner can change */}
            {selectedCharacter.userId === userId ? (
              <select
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as 'private' | 'public')}
                className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm text-amber-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
              >
                <option value="private">🔒 Private</option>
                <option value="public">🌐 Public</option>
              </select>
            ) : (
              <span className="flex items-center gap-1 px-3 py-2 text-sm text-stone-400 border border-stone-700/30 rounded">
                {selectedCharacter.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
              </span>
            )}
            <button onClick={handleSavePreview} className="flex items-center gap-2 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 text-sm cursor-pointer">
              <Save size={16} /> Save Changes
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left: Identity */}
          <div className="md:col-span-1 border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] pointer-events-none"></div>
            <div className="relative z-10">
              <div className="w-24 h-24 rounded-full border-2 border-amber-500/50 bg-amber-950/40 mx-auto flex items-center justify-center text-5xl mb-4 shadow-xl">
                {editClass.toLowerCase().includes('arcanist') || editClass.toLowerCase().includes('mage') ? '🔮' : '⚔️'}
              </div>
              <h2 className="text-3xl font-bold text-amber-200 mb-1 text-center" style={{ fontFamily: "'Cinzel', serif" }}>{editName}</h2>
              <p className="text-amber-500/70 text-lg mb-4 italic text-center">{editRace} • {editClass}</p>

              <div className="flex justify-around items-center bg-amber-950/30 border border-amber-800/20 p-3 rounded-xl mb-6">
                <div className="text-center">
                  <p className="text-xs text-amber-600 tracking-wider">LEVEL</p>
                  <p className="text-2xl font-bold text-amber-300 font-mono">{editLevel}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-amber-600 tracking-wider">HP MAX</p>
                  <p className="text-2xl font-bold text-amber-300 font-mono">{editLevel * 10 + Math.floor((attributes.CON - 10) / 2)}</p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Backstory / Notes</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={6} className="w-full bg-stone-900 border border-stone-800 rounded-lg p-3 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 font-serif resize-none" placeholder="The legend begins here..." />
              </div>

              {/* Character Tags */}
              <div className="text-left w-full border-t border-amber-800/20 pt-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-1">Character Tags</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={charTagInput}
                    onChange={(e) => setCharTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && charTagInput.trim()) {
                        e.preventDefault();
                        if (!charTags.includes(charTagInput.trim())) {
                          setCharTags([...charTags, charTagInput.trim()]);
                        }
                        setCharTagInput('');
                      }
                    }}
                    placeholder="Add tag and press Enter"
                    className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-1 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {charTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setCharTags(charTags.filter(t => t !== tag))}
                      className="px-2 py-0.5 bg-amber-950/40 border border-amber-800/40 hover:border-red-500/40 rounded text-[10px] text-amber-300 hover:text-red-400 transition-all font-mono flex items-center gap-1 cursor-pointer"
                      title="Click to remove"
                    >
                      {tag} <X size={10} />
                    </button>
                  ))}
                  {charTags.length === 0 && <span className="text-[10px] text-stone-600 italic">No tags added yet.</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Attributes */}
          <div className="md:col-span-2 border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
            <div className="relative z-10">
              {/* 1. Main Attributes */}
              <div className="mb-8">
                <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Main Attributes
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowModOptions(!showModOptions)}
                      className="p-1.5 text-amber-500 hover:text-amber-300 cursor-pointer"
                      title="Modifier Formula"
                    >
                      <Settings size={18} />
                    </button>
                    <button
                      onClick={() => setMainAttrs([...mainAttrs, { id: `attr_${Date.now().toString(36)}`, name: 'New Attribute', value: '10' }])}
                      className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {showModOptions && (
                  <div className="mb-4 p-3 bg-stone-900/80 border border-amber-800/30 rounded-lg">
                    <label className="block text-xs font-bold text-amber-500 mb-1">Modifier Formula (use @value for own value)</label>
                    <input
                      type="text"
                      value={modFormula}
                      onChange={(e) => setModFormula(e.target.value)}
                      className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-sm font-mono text-amber-200 focus:outline-none"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {mainAttrs.map((attr, idx) => {
                    const finalContext = getCharacterContext();
                    const evalVal = finalContext[attr.id] || 0;
                    const modVal = finalContext[`${attr.id}_mod`] || 0;

                    return (
                      <div key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-3 flex flex-col gap-2 shadow-lg">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={attr.name}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[idx].name = e.target.value;
                              setMainAttrs(next);
                            }}
                            className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                          />
                          <input
                            type="text"
                            value={attr.id}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[idx].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                              setMainAttrs(next);
                            }}
                            className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-16"
                            placeholder="id"
                          />
                          <button
                            onClick={() => setMainAttrs(mainAttrs.filter((_, i) => i !== idx))}
                            className="text-stone-600 hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={attr.value}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[idx].value = e.target.value;
                              setMainAttrs(next);
                            }}
                            className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 w-24 focus:outline-none"
                          />
                          <div className="flex flex-col items-end">
                            <span className="text-lg font-bold font-mono text-amber-200">{evalVal}</span>
                            <span className="text-xs font-mono font-bold bg-amber-900/40 px-2 py-0.5 rounded text-amber-400">
                              {modVal >= 0 ? `+${modVal}` : modVal}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Secondary Attributes */}
              <div className="mb-8">
                <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Secondary Attributes
                  </h3>
                  <button
                    onClick={() => setSecondaryAttrs([...secondaryAttrs, { id: `sec_${Date.now().toString(36)}`, name: 'New Attribute', value: '10' }])}
                    className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                  >
                    + Add
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {secondaryAttrs.map((attr, idx) => {
                    const finalContext = getCharacterContext();
                    const evalVal = finalContext[attr.id] || 0;

                    return (
                      <div key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-3 flex flex-col gap-2 shadow-lg">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={attr.name}
                            onChange={(e) => {
                              const next = [...secondaryAttrs];
                              next[idx].name = e.target.value;
                              setSecondaryAttrs(next);
                            }}
                            className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                          />
                          <input
                            type="text"
                            value={attr.id}
                            onChange={(e) => {
                              const next = [...secondaryAttrs];
                              next[idx].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                              setSecondaryAttrs(next);
                            }}
                            className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-16"
                            placeholder="id"
                          />
                          <button
                            onClick={() => setSecondaryAttrs(secondaryAttrs.filter((_, i) => i !== idx))}
                            className="text-stone-600 hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center justify-end">
                          <input
                            type="text"
                            value={attr.value}
                            onChange={(e) => {
                              const next = [...secondaryAttrs];
                              next[idx].value = e.target.value;
                              setSecondaryAttrs(next);
                            }}
                            className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 w-24 focus:outline-none mr-auto"
                          />
                          <span className="text-lg font-bold font-mono text-amber-200">{evalVal}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Statuses */}
              <div className="mb-4">
                <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Statuses & Effects
                  </h3>
                  <button
                    onClick={() => setCharStatuses([...charStatuses, { id: `st_${Date.now().toString(36)}`, name: 'New Status', duration: '1 round', description: '', effects: [] }])}
                    className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                  >
                    + Add Status
                  </button>
                </div>

                <div className="space-y-4">
                  {charStatuses.map((status, idx) => (
                    <div key={status.id} className="bg-amber-950/10 border border-amber-800/20 rounded-xl p-4 shadow-lg flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          value={status.name}
                          onChange={(e) => {
                            const next = [...charStatuses];
                            next[idx].name = e.target.value;
                            setCharStatuses(next);
                          }}
                          className="bg-transparent text-base font-bold text-amber-200 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-40"
                        />
                        <input
                          type="text"
                          value={status.duration}
                          onChange={(e) => {
                            const next = [...charStatuses];
                            next[idx].duration = e.target.value;
                            setCharStatuses(next);
                          }}
                          className="bg-stone-900/40 border border-stone-800/40 rounded px-2 py-1 text-xs text-amber-500 w-24 focus:outline-none"
                          placeholder="Duration"
                        />
                        <button
                          onClick={() => setCharStatuses(charStatuses.filter((_, i) => i !== idx))}
                          className="text-stone-600 hover:text-red-400 cursor-pointer ml-auto"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      
                      <textarea
                        value={status.description}
                        onChange={(e) => {
                          const next = [...charStatuses];
                          next[idx].description = e.target.value;
                          setCharStatuses(next);
                        }}
                        placeholder="Description of the status"
                        rows={2}
                        className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1.5 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none"
                      />

                      {/* Effects area */}
                      <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs font-bold text-stone-400">Effects</label>
                          <button
                            onClick={() => {
                              const next = [...charStatuses];
                              next[idx].effects = [...(next[idx].effects || []), { targetId: '', value: '0' }];
                              setCharStatuses(next);
                            }}
                            className="text-[10px] bg-amber-900/20 hover:bg-amber-900/40 px-2 py-0.5 rounded text-amber-300"
                          >
                            + Add Effect
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(status.effects || []).map((effect, effIdx) => (
                            <div key={effIdx} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={effect.targetId}
                                onChange={(e) => {
                                  const next = [...charStatuses];
                                  next[idx].effects[effIdx].targetId = e.target.value;
                                  setCharStatuses(next);
                                }}
                                placeholder="Target ID (e.g. wis_mod)"
                                className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-emerald-400 font-mono focus:outline-none w-1/2"
                              />
                              <input
                                type="text"
                                value={effect.value}
                                onChange={(e) => {
                                  const next = [...charStatuses];
                                  next[idx].effects[effIdx].value = e.target.value;
                                  setCharStatuses(next);
                                }}
                                placeholder="Value (e.g. -2)"
                                className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 font-mono focus:outline-none w-1/4"
                              />
                              <button
                                onClick={() => {
                                  const next = [...charStatuses];
                                  next[idx].effects = next[idx].effects.filter((_, i) => i !== effIdx);
                                  setCharStatuses(next);
                                }}
                                className="text-stone-600 hover:text-red-400 cursor-pointer ml-auto"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          {(status.effects || []).length === 0 && <span className="text-[10px] text-stone-600 italic">No effects added.</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main List View ────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex flex-col gap-6" style={{ fontFamily: "'IM Fell English', serif" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-900/30 pb-4">
        <div>
          <h2 className="text-3xl font-bold text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>🛡️ Characters</h2>
          <p className="text-stone-400 text-sm mt-1">Build your roster of heroes. All data is saved securely.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleCreate} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 text-sm cursor-pointer shadow-md">
            <Plus size={16} /> Create Character
          </button>
          <button onClick={fetchAll} className="flex items-center gap-1.5 px-3 py-2 bg-stone-700/40 text-stone-300 rounded border border-stone-600/40 hover:bg-stone-700/60 text-sm cursor-pointer shadow-md">
            <RefreshCw size={14} /> Sync All
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 bg-amber-900/10 border border-amber-800/30 rounded-xl flex flex-col gap-4 shadow-lg select-none">
        <h3 className="text-sm font-bold text-amber-300 uppercase tracking-widest flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
          <Filter size={16} /> Advanced Filters & Searching
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-400">Search by Name</label>
            <div className="relative flex items-center bg-stone-900/80 border border-stone-700 rounded p-1">
              <Search size={16} className="text-stone-500 ml-2" />
              <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Type a name..." className="w-full bg-transparent px-2 py-1 text-sm text-amber-100 focus:outline-none placeholder-stone-700 font-serif" />
              {searchName && <button onClick={() => setSearchName('')} className="text-stone-600 hover:text-stone-300 p-1 cursor-pointer"><X size={14} /></button>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-400">Filter by Tag (Class or Race)</label>
            <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={handleAddTag} placeholder="Type tag + Enter..." className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-1.5 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 placeholder-stone-700" />
          </div>
          <div className="flex flex-col justify-end">
            <button onClick={() => setShowOnlyFavs(!showOnlyFavs)} className={`flex items-center justify-center gap-2 h-[38px] px-4 border rounded text-xs font-bold tracking-wider cursor-pointer transition-all ${showOnlyFavs ? 'bg-amber-900/50 border-amber-500 text-amber-200' : 'bg-stone-900/50 border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-300'}`} style={{ fontFamily: "'Cinzel', serif" }}>
              <Star size={14} fill={showOnlyFavs ? 'currentColor' : 'none'} />
              <span>Only Favorites</span>
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={applyFilters} className="flex-1 flex items-center justify-center h-[38px] px-3 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-800/40 rounded text-xs text-amber-200 font-bold cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>Filter</button>
            <button onClick={clearFilters} className="flex-1 flex items-center justify-center h-[38px] px-3 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-xs text-stone-300 font-bold cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>Clear</button>
          </div>
        </div>
        {filterTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-amber-800/20 pt-3">
            <span className="text-xs text-stone-500 self-center mr-1">Active Tags:</span>
            {filterTags.map(tag => (
              <button key={tag} onClick={() => removeTag(tag)} className="flex items-center gap-1 px-2 py-1 bg-amber-900/30 border border-amber-800/30 hover:border-red-500/50 rounded-md text-xs text-amber-300 hover:text-red-400 transition-all cursor-pointer font-mono">
                {tag} <X size={12} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Character List + Quick Editor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-[500px]">
        {/* Character List */}
        <div className="rounded-xl border border-amber-800/40 bg-stone-950/40 p-5 flex flex-col overflow-hidden">
          <h3 className="text-lg text-amber-300 font-bold mb-4 flex items-center justify-between" style={{ fontFamily: "'Cinzel', serif" }}>
            <span>📜 Character List</span>
            <span className="text-xs bg-amber-900/30 border border-amber-800/30 text-amber-400 px-2 py-0.5 rounded font-mono">
              {filteredCharacters.length} / {characters.length}
            </span>
          </h3>
          {filteredCharacters.length === 0 ? (
            <div className="text-stone-500 text-center py-16 border border-dashed border-stone-700 rounded-lg flex-1 flex items-center justify-center">
              No adventurers match your filters.
            </div>
          ) : (
            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {filteredCharacters.map((char) => {
                const isSelected = selectedCharacter?.id === char.id;
                const isFav = favoriteIds.includes(char.id);
                return (
                  <div
                    key={char.id}
                    onClick={() => setSelectedCharacter(char)}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all select-none group ${isSelected ? 'bg-amber-900/30 border-amber-500/50 shadow-md ring-1 ring-inset ring-amber-500/30' : 'bg-black/20 border-stone-800/50 hover:bg-amber-950/10 hover:border-stone-700/60'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center font-bold text-sm shrink-0 font-mono transition-all ${isSelected ? 'border-amber-400 bg-amber-900/50 text-amber-200' : 'border-amber-700/30 bg-stone-900/60 text-amber-300/80'}`}>
                        {char.level}
                      </div>
                      <div className="min-w-0">
                        <h4 className={`text-base font-bold truncate ${isSelected ? 'text-amber-100' : 'text-amber-200/80 group-hover:text-amber-200'}`} style={{ fontFamily: "'Cinzel', serif" }}>
                          {char.name}
                          {char.visibility === 'public' && char.userId !== userId && (
                            <span className="ml-1.5 text-xs text-sky-400/70">🌐</span>
                          )}
                        </h4>
                        <p className="text-xs text-amber-600/70 italic truncate">
                          {char.race} • {char.className}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={(e) => handleToggleFav(e, char.id)}
                        className={`p-1.5 rounded-full hover:bg-amber-800/20 transition-colors cursor-pointer ${isFav ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'}`}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star size={16} fill={isFav ? 'currentColor' : 'none'} />
                      </button>
                      {(char.userId === userId || !char.userId) && (
                        <button
                          onClick={(e) => handleDelete(e, char.id)}
                          className="p-1.5 text-stone-700 hover:text-red-400 opacity-0 group-hover:opacity-100 rounded-full hover:bg-red-950/20 transition-all cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Editor */}
        <div className="rounded-xl border border-amber-800/40 bg-stone-950/40 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg text-amber-300 font-bold" style={{ fontFamily: "'Cinzel', serif" }}>⚔️ Quick Editor</h3>
              {selectedCharacter && (
                <span className="text-xs font-mono text-amber-500/70">
                  ID: {selectedCharacter.id.slice(0, 8)} • {selectedCharacter.userId === userId ? 'Owner' : 'Viewer'}
                </span>
              )}
            </div>

            {!selectedCharacter ? (
              <div className="text-stone-500 text-center py-16 flex items-center justify-center h-full italic">
                Select a character to edit.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Level</label>
                    <input type="number" min={1} max={30} value={editLevel} onChange={(e) => setEditLevel(parseInt(e.target.value, 10) || 1)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Race</label>
                    <input value={editRace} onChange={(e) => setEditRace(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" placeholder="Human, Elf..." />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Vocation / Class</label>
                  <input value={editClass} onChange={(e) => setEditClass(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" placeholder="Vanguard, Arcanist..." />
                </div>

                {/* Visibility Dropdown */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Visibility</label>
                  {selectedCharacter.userId === userId || !selectedCharacter.userId ? (
                    <select
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value as 'private' | 'public')}
                      className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                    >
                      <option value="private">🔒 Private — only you can see this</option>
                      <option value="public">🌐 Public — everyone can see this</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-sm text-stone-400">
                      <span>{selectedCharacter.visibility === 'public' ? '🌐 Public' : '🔒 Private'}</span>
                      <span className="text-xs text-stone-600">(read only — owner only)</span>
                    </div>
                  )}
                </div>

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleSavePreview}
                    className="flex-1 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 transition-colors text-sm font-bold tracking-wider cursor-pointer flex items-center justify-center gap-2"
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    <Save size={16} /> Save Basics
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedCharacter && (
            <div className="mt-6 border-t border-amber-800/20 pt-4">
              <button
                onClick={() => setIsViewingSheet(true)}
                className="w-full px-6 py-3 bg-amber-800/30 border-2 border-amber-700 rounded-md hover:bg-amber-800/50 text-amber-100 transition-all font-bold text-center text-base tracking-wider cursor-pointer shadow-lg hover:shadow-amber-900/30"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                📜 Load Character Sheet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Characters;
