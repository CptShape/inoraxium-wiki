import React, { useEffect, useState } from 'react';
import { ArrowLeft, Backpack, FlaskConical, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react';
import { CharacterBar, CharacterData, CharacterLocalVariable, CustomAttribute, SkillAttribute, StatusEffect } from '../types/character';
import { loadCharacterById } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { HomebrewLibraryCategory } from './HomebrewLibraryViewer';

interface HomebrewCharacterSheetViewerProps {
  characterId: string;
  onBack?: () => void;
}

const parchmentBackground = {
  backgroundImage:
    "radial-gradient(circle at top left, rgba(120,53,15,0.12), transparent 35%), linear-gradient(180deg, rgba(245,232,197,0.98) 0%, rgba(235,219,184,0.98) 100%)",
};

const sectionClass =
  'rounded-2xl border border-amber-900/20 bg-white/45 p-6 shadow-[0_18px_36px_rgba(68,38,17,0.12)] backdrop-blur-[1px]';

const openLibrary = (category: HomebrewLibraryCategory, characterId: string) => {
  window.location.hash = `#homebrew-library/${category}/${encodeURIComponent(characterId)}`;
};

const evalFormula = (
  formula: string,
  context: Record<string, number>,
  localContext: Record<string, number> = {},
): number => {
  if (!formula) return 0;

  let expr = formula.replace(/@@([a-zA-Z0-9_-]+)/g, (_match, id) => String(localContext[id] ?? 0));
  expr = expr
    .replace(/(^|[^@])@([a-zA-Z0-9_-]+)/g, (_match, prefix, id) => `${prefix}${context[id] ?? 0}`)
    .replace(/roundup/g, 'Math.ceil')
    .replace(/rounddown/g, 'Math.floor')
    .replace(/round/g, 'Math.round')
    .replace(/max/g, 'Math.max')
    .replace(/min/g, 'Math.min');

  try {
    const result = new Function(`"use strict"; return (${expr});`)();
    return typeof result === 'number' && Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};

const getBarMode = (bar: CharacterBar) => bar.mode || 'default';

const getLocalVariableContext = (
  variables: CharacterLocalVariable[] | undefined,
  globalContext: Record<string, number>,
) => {
  const localContext: Record<string, number> = {};
  (variables || []).forEach((variable) => {
    if (!variable.id) return;
    if (variable.kind === 'input') return;
    localContext[variable.id] = evalFormula(variable.value || '0', globalContext, localContext);
  });
  return localContext;
};

const applyAttributeEffectValue = (
  attr: CustomAttribute | SkillAttribute | undefined,
  baseValue: number,
  contributions: number[],
) => {
  if (attr?.calculationType === 'override-highest') {
    return baseValue + (contributions.length ? Math.max(...contributions) : 0);
  }
  if (attr?.calculationType === 'override-lowest') {
    return baseValue + (contributions.length ? Math.min(...contributions) : 0);
  }
  return baseValue + contributions.reduce((sum, value) => sum + value, 0);
};

const buildHomebrewContext = (character: CharacterData): Record<string, number> => {
  const context: Record<string, number> = {};
  const mainAttrs = character.mainAttributes || [];
  const baseAttrs = [
    ...mainAttrs,
    ...(character.secondaryAttributes || []),
    ...(character.otherAttributes || []),
    ...(character.resistances || []),
  ];
  const skillAttrs = character.skills || [];
  const attrs = [...baseAttrs, ...skillAttrs];
  const attrById = new Map(attrs.map((attr) => [attr.id, attr]));
  const bars = character.bars || [];
  const mainAttrIds = mainAttrs.map((attr) => attr.id).filter(Boolean);
  const baseAttrIds = baseAttrs.map((attr) => attr.id).filter(Boolean);
  const skillIds = skillAttrs.map((attr) => attr.id).filter(Boolean);
  const modIds = mainAttrIds.map((id) => `${id}_mod`);

  const applyEffectsFromSources = (
    targetIds: string[],
    baseValues: Record<string, number>,
    sourceContext: Record<string, number>,
  ) => {
    const nextValues = { ...baseValues };
    const buckets: Record<string, number[]> = {};

    const collectEffect = (
      effect: StatusEffect,
      localContext: Record<string, number>,
    ) => {
      if (effect.effectType && effect.effectType !== 'attribute') return;
      if (!(effect.active ?? true) || !effect.targetId || !targetIds.includes(effect.targetId)) return;
      if (!buckets[effect.targetId]) buckets[effect.targetId] = [];
      buckets[effect.targetId].push(evalFormula(effect.value || '0', sourceContext, localContext));
    };

    (character.statuses || []).forEach((status) => {
      if ((status.active ?? true) === false) return;
      const localContext = getLocalVariableContext(status.localVariables, sourceContext);
      (status.effects || []).forEach((effect) => collectEffect(effect, localContext));
      (status.actions || []).forEach((action) => (action.effects || []).forEach((effect) => collectEffect(effect, localContext)));
    });

    [...(character.generalItems || []), ...(character.inventory || [])].forEach((item) => {
      if (!item.equipped) return;
      const localContext = getLocalVariableContext(item.localVariables, sourceContext);
      (item.effects || []).forEach((effect) => collectEffect(effect, localContext));
      (item.actions || []).forEach((action) => (action.effects || []).forEach((effect) => collectEffect(effect, localContext)));
    });

    (character.spells || []).forEach((spell) => {
      const localContext = getLocalVariableContext(spell.localVariables, sourceContext);
      (spell.actions || []).forEach((action) => (action.effects || []).forEach((effect) => collectEffect(effect, localContext)));
    });

    Object.entries(buckets).forEach(([targetId, values]) => {
      nextValues[targetId] = applyAttributeEffectValue(attrById.get(targetId), nextValues[targetId] || 0, values);
    });

    return nextValues;
  };

  const allEffectTargetIds = new Set<string>();
  const collectTargetId = (effect: StatusEffect) => {
    if (effect.effectType && effect.effectType !== 'attribute') return;
    if (effect.targetId) allEffectTargetIds.add(effect.targetId);
  };
  (character.statuses || []).forEach((status) => {
    (status.effects || []).forEach(collectTargetId);
    (status.actions || []).forEach((action) => (action.effects || []).forEach(collectTargetId));
  });
  [...(character.generalItems || []), ...(character.inventory || [])].forEach((item) => {
    (item.effects || []).forEach(collectTargetId);
    (item.actions || []).forEach((action) => (action.effects || []).forEach(collectTargetId));
  });
  (character.spells || []).forEach((spell) => {
    (spell.actions || []).forEach((action) => (action.effects || []).forEach(collectTargetId));
  });

  attrs.forEach((attr) => {
    if (attr.id) context[attr.id] = 0;
  });
  modIds.forEach((id) => {
    context[id] = 0;
  });
  bars.forEach((bar) => {
    if (!bar.id) return;
    context[`${bar.id}_current`] = 0;
    if (getBarMode(bar) === 'resource') {
      context[`${bar.id}_reset`] = 0;
    } else {
      context[`${bar.id}_max`] = 0;
    }
  });
  allEffectTargetIds.forEach((id) => {
    if (!(id in context)) context[id] = 0;
  });

  const MAX_PASSES = 12;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const previousContext = { ...context };
    const nextContext: Record<string, number> = {};

    baseAttrs.forEach((attr) => {
      if (attr.id) nextContext[attr.id] = evalFormula(attr.value || '0', previousContext);
    });

    const attributesWithStatuses = applyEffectsFromSources(baseAttrIds, nextContext, {
      ...previousContext,
      ...nextContext,
    });

    mainAttrIds.forEach((attrId) => {
      const attrValue = attributesWithStatuses[attrId] || 0;
      const formula = (character.modifierFormula || 'rounddown((@value - 10) / 2)').replace(/@value/g, String(attrValue));
      attributesWithStatuses[`${attrId}_mod`] = evalFormula(formula, {
        ...previousContext,
        ...attributesWithStatuses,
      });
    });

    const withModEffects = applyEffectsFromSources(modIds, attributesWithStatuses, {
      ...previousContext,
      ...attributesWithStatuses,
    });

    skillAttrs.forEach((skill) => {
      if (!skill.id) return;
      const legacyBaseValue = evalFormula(skill.value || '0', {
        ...previousContext,
        ...withModEffects,
      });
      const linkedModifierValue = skill.linkedMainAttributeId
        ? withModEffects[`${skill.linkedMainAttributeId}_mod`] ?? 0
        : 0;
      const proficiencyValue = withModEffects.proficiency ?? 0;
      const mode = skill.proficiencyMode || 'none';
      const proficiencyBonus = mode === 'half'
        ? Math.floor(proficiencyValue / 2)
        : mode === 'proficient'
          ? proficiencyValue
          : mode === 'expertise'
            ? proficiencyValue * 2
            : 0;
      withModEffects[skill.id] = applyAttributeEffectValue(
        skill,
        legacyBaseValue + linkedModifierValue,
        proficiencyBonus !== 0 ? [proficiencyBonus] : [],
      );
    });

    let allValuesWithEffects = applyEffectsFromSources(skillIds, withModEffects, {
      ...previousContext,
      ...withModEffects,
    });

    const looseEffectIds = Array.from(allEffectTargetIds).filter((id) => (
      !baseAttrIds.includes(id) && !skillIds.includes(id) && !modIds.includes(id)
    ));
    allValuesWithEffects = applyEffectsFromSources(looseEffectIds, allValuesWithEffects, {
      ...previousContext,
      ...allValuesWithEffects,
    });

    bars.forEach((bar) => {
      if (!bar.id) return;
      allValuesWithEffects[`${bar.id}_current`] = evalFormula(bar.currentValue || '0', {
        ...previousContext,
        ...allValuesWithEffects,
      });
      if (getBarMode(bar) === 'resource') {
        allValuesWithEffects[`${bar.id}_reset`] = evalFormula(bar.resetValue || '0', {
          ...previousContext,
          ...allValuesWithEffects,
        });
      } else {
        allValuesWithEffects[`${bar.id}_max`] = evalFormula(bar.maxValue || '0', {
          ...previousContext,
          ...allValuesWithEffects,
        });
      }
    });

    let hasChanged = false;
    const nextKeys = new Set([...Object.keys(context), ...Object.keys(allValuesWithEffects)]);
    nextKeys.forEach((key) => {
      const nextValue = allValuesWithEffects[key] ?? 0;
      if (Math.abs((previousContext[key] ?? 0) - nextValue) > 0.0001) {
        hasChanged = true;
      }
      context[key] = nextValue;
    });

    if (!hasChanged) break;
  }

  return context;
};

const formatSigned = (value: number) => (value >= 0 ? `+${value}` : String(value));

const getBarFillDetail = (bar: CharacterBar | undefined, context: Record<string, number>) => {
  if (!bar?.id) return { fill: 0, current: 0, maxOrReset: 0 };
  const current = context[`${bar.id}_current`] ?? 0;
  const maxOrReset = getBarMode(bar) === 'resource'
    ? context[`${bar.id}_reset`] ?? 0
    : context[`${bar.id}_max`] ?? 0;
  if (!maxOrReset) return { fill: 0, current, maxOrReset };
  return {
    fill: Math.max(0, Math.min(100, (current / maxOrReset) * 100)),
    current,
    maxOrReset,
  };
};

export const HomebrewCharacterSheetViewer: React.FC<HomebrewCharacterSheetViewerProps> = ({
  characterId,
  onBack,
}) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => authProvider.onAuthChange((state) => setUserId(state.uid)), []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    loadCharacterById(characterId, userId)
      .then((loadedCharacter) => {
        if (!isMounted) return;
        if (!loadedCharacter) {
          setCharacter(null);
          setError('This character could not be found, or you do not have access to it.');
        } else {
          setCharacter(loadedCharacter);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error(err);
        setError('Failed to load this homebrew character sheet.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [characterId, userId]);

  const libraryCards: Array<{
    category: HomebrewLibraryCategory;
    title: string;
    subtitle: string;
    count: number;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      category: 'inventory',
      title: 'Inventory',
      subtitle: 'Items, general items, images, rarity, quantity, and details.',
      count: (character?.generalItems?.length || 0) + (character?.inventory?.length || 0),
      icon: <Backpack size={28} />,
      accent: '#7c4b1f',
    },
    {
      category: 'spells',
      title: 'Spells',
      subtitle: 'Spells, abilities, resource costs, actions, and effects.',
      count: character?.spells?.length || 0,
      icon: <Sparkles size={28} />,
      accent: '#6b21a8',
    },
    {
      category: 'statuses',
      title: 'Statuses',
      subtitle: 'Conditions, timers, active states, actions, and effects.',
      count: character?.statuses?.length || 0,
      icon: <FlaskConical size={28} />,
      accent: '#b45309',
    },
  ];
  const overviewContext = character ? buildHomebrewContext(character) : {};
  const overviewMainAttributes = character
    ? (character.overviewSettings?.mainAttributeIds || [])
      .map((id) => (character.mainAttributes || []).find((attr) => attr.id === id))
      .filter((attr): attr is CustomAttribute => !!attr)
    : [];
  const overviewBoxes = character?.overviewSettings?.valueBoxes || [];
  const overviewAttributes = character
    ? [
      ...(character.mainAttributes || []),
      ...(character.secondaryAttributes || []),
      ...(character.skills || []),
      ...(character.otherAttributes || []),
      ...(character.resistances || []),
    ]
    : [];
  const getOverviewDisplayValue = (valueId: string) => {
    const rawValue = overviewContext[valueId] ?? 0;
    const attribute = overviewAttributes.find((attr) => attr.id === valueId);
    const option = attribute?.valueOptions?.find((item) => (
      item.value === String(rawValue) || Number(item.value) === rawValue
    ));
    return option?.label || rawValue;
  };
  const getAttributeDisplayValue = (attribute: CustomAttribute | SkillAttribute, resistanceMode = false) => {
    const value = getOverviewDisplayValue(attribute.id);
    if (!resistanceMode || typeof value === 'string') return value;
    return value < 0 ? `-%${Math.abs(value)}` : `%${value}`;
  };
  const attributeSections: Array<{
    id: string;
    title: string;
    subtitle: string;
    items: Array<CustomAttribute | SkillAttribute>;
    resistanceMode?: boolean;
    skillMode?: boolean;
  }> = character ? [
    {
      id: 'main',
      title: 'Main Attributes',
      subtitle: 'Core stats and their modifier values.',
      items: character.mainAttributes || [],
    },
    {
      id: 'secondary',
      title: 'Secondary Attributes',
      subtitle: 'Derived and supporting character values.',
      items: character.secondaryAttributes || [],
    },
    {
      id: 'skills',
      title: 'Skills',
      subtitle: 'Skill values and linked main attributes.',
      items: character.skills || [],
      skillMode: true,
    },
    {
      id: 'other',
      title: 'Other Attributes',
      subtitle: 'Custom attributes that do not fit the other groups.',
      items: character.otherAttributes || [],
    },
    {
      id: 'resistances',
      title: 'Resistances',
      subtitle: 'Damage and effect resistance percentages.',
      items: character.resistances || [],
      resistanceMode: true,
    },
  ] : [];

  return (
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] p-6 text-stone-900" style={parchmentBackground}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-white/45 px-4 py-2 text-sm text-amber-950 hover:bg-white/65 cursor-pointer"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="rounded-full border border-amber-900/20 bg-white/45 px-4 py-2 text-sm text-stone-700">
            Homebrew Character Sheet
          </div>
        </div>

        {isLoading ? (
          <div className={`${sectionClass} text-center text-lg text-stone-700`}>Loading character sheet...</div>
        ) : error ? (
          <div className={`${sectionClass} text-center text-lg text-rose-900`}>{error}</div>
        ) : character ? (
          <div className="space-y-6">
            <section className={`${sectionClass} relative overflow-hidden`}>
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-800 via-amber-600 to-transparent" />
              <div className="grid gap-6 md:grid-cols-[140px_1fr] md:items-center">
                <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-3xl border border-amber-900/25 bg-amber-100/45 text-amber-900 shadow-inner">
                  {character.portraitUrl ? (
                    <img src={character.portraitUrl} alt={character.name} className="h-full w-full object-cover" />
                  ) : (
                    <UserRound size={48} />
                  )}
                </div>
                <div>
                  <div className="mb-3 inline-flex rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
                    Homebrew Character Sheet
                  </div>
                  <h1 className="text-5xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                    {character.name || 'Unnamed Character'}
                  </h1>
                  <p className="mt-3 text-xl italic text-stone-700" style={{ fontFamily: "'IM Fell English', serif" }}>
                    {character.race || 'Unknown Race'} • {character.className || 'Unknown Class'}
                  </p>
                  {character.tags && character.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {character.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-amber-900/15 bg-white/45 px-3 py-1 text-xs text-amber-950">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {(overviewMainAttributes.length > 0 || overviewBoxes.length > 0) && (
              <section className="overflow-hidden rounded-[2rem] border-[3px] border-amber-950/55 bg-[#d8c996] shadow-[0_28px_70px_rgba(68,38,17,0.28)]">
                <div className="border-b-[3px] border-stone-950/55 bg-[#8d8562]/95 px-6 py-4 shadow-[0_8px_0_rgba(0,0,0,0.22)]">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-3xl uppercase tracking-[0.16em] text-stone-900" style={{ fontFamily: "'Cinzel', serif" }}>{character.name}</h2>
                      <p className="text-sm uppercase tracking-[0.12em] text-stone-700">{character.race} / {character.className}</p>
                    </div>
                    {character.alignment && <span className="rounded border border-stone-900/40 px-3 py-1 text-xs uppercase tracking-[0.14em] text-stone-800">{character.alignment}</span>}
                  </div>
                </div>
                <div className="relative min-h-[620px] overflow-hidden bg-stone-900">
                  {character.portraitUrl ? (
                    <>
                      <img src={character.portraitUrl} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover opacity-25 blur-xl" />
                      <img src={character.portraitUrl} alt="" className="absolute inset-0 h-full w-full object-contain object-center opacity-95" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-950 via-stone-800 to-emerald-950" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/5 to-black/35" />
                  <div className="relative z-10 grid min-h-[620px] gap-5 px-4 py-8 md:grid-cols-[120px_1fr_220px] md:px-6">
                  <div className="flex flex-col justify-center gap-4">
                    {overviewMainAttributes.map((attr) => {
                      const value = overviewContext[attr.id] ?? 0;
                      const modifier = overviewContext[`${attr.id}_mod`] ?? 0;
                      return (
                        <div key={attr.id} className="relative flex items-center gap-2">
                          <div className="grid h-20 w-20 rotate-45 place-items-center border-[3px] border-stone-950 bg-[#7c6f3f] shadow-[0_5px_0_rgba(0,0,0,0.35)]">
                            <span className="-rotate-45 text-2xl font-black text-white drop-shadow">{formatSigned(modifier)}</span>
                          </div>
                          <div className="grid h-10 w-10 rotate-45 place-items-center border-2 border-stone-950 bg-[#b8aa72] shadow">
                            <span className="-rotate-45 text-sm font-black text-stone-950">{value}</span>
                          </div>
                          <span className="absolute -right-1 -top-2 rounded bg-stone-950/75 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                            {attr.name || attr.id}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden md:block" />

                  <div className="flex flex-col justify-center gap-3">
                    {overviewBoxes.map((box) => {
                      const boxMode = box.mode || 'default';
                      const primaryUsesColor = box.barId === '__color';
                      const secondaryUsesColor = box.secondaryBarId === '__color';
                      const primaryBar = primaryUsesColor ? undefined : (character.bars || []).find((item) => item.id === box.barId);
                      const primaryFill = primaryUsesColor ? { fill: 100, current: 0, maxOrReset: 0 } : getBarFillDetail(primaryBar, overviewContext);
                      const primaryFillPercent = Math.round(primaryFill.fill);
                      const primaryColor = primaryUsesColor ? (box.color || '#0ea5e9') : (primaryBar?.color || '#0ea5e9');

                      if (boxMode === 'two-sided') {
                        const secondaryBar = secondaryUsesColor ? undefined : (character.bars || []).find((item) => item.id === box.secondaryBarId);
                        const secondaryFill = secondaryUsesColor ? { fill: 100, current: 0, maxOrReset: 0 } : getBarFillDetail(secondaryBar, overviewContext);
                        const secondaryFillPercent = Math.round(secondaryFill.fill);
                        const secondaryColor = secondaryUsesColor ? (box.secondaryColor || '#ef4444') : (secondaryBar?.color || '#ef4444');
                        return (
                          <div
                            key={box.id}
                            className="overflow-hidden rounded-xl border-2 border-stone-950 bg-stone-950/75 shadow-[0_5px_0_rgba(0,0,0,0.32)]"
                            title={`${primaryUsesColor ? 'Left Color' : `${primaryBar?.name || box.barId || 'Left'}: ${primaryFill.current} / ${primaryFill.maxOrReset} (${primaryFillPercent}%)`} | ${secondaryUsesColor ? 'Right Color' : `${secondaryBar?.name || box.secondaryBarId || 'Right'}: ${secondaryFill.current} / ${secondaryFill.maxOrReset} (${secondaryFillPercent}%)`}`}
                          >
                            <div className="relative px-4 py-5 text-center">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#5f573d]/95 via-[#8d8562]/95 to-[#5f573d]/95" />
                              <div
                                className="absolute inset-y-0"
                                style={{
                                  right: '50%',
                                  width: `${primaryFill.fill / 2}%`,
                                  background: `linear-gradient(270deg, ${primaryColor}, ${primaryColor}dd)`,
                                }}
                              />
                              <div
                                className="absolute inset-y-0"
                                style={{
                                  left: '50%',
                                  width: `${secondaryFill.fill / 2}%`,
                                  background: `linear-gradient(90deg, ${secondaryColor}, ${secondaryColor}dd)`,
                                }}
                              />
                              <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-stone-950/75" />
                              <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-black/10" />
                              <div className="relative z-10 text-[11px] font-black uppercase tracking-[0.18em] text-stone-950 drop-shadow-sm">
                                {box.label || 'Two-Sided'}
                              </div>
                              {!primaryUsesColor && (
                                <div className="absolute bottom-1 left-2 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                  {primaryFillPercent}%
                                </div>
                              )}
                              {!secondaryUsesColor && (
                                <div className="absolute bottom-1 right-2 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                  {secondaryFillPercent}%
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      if (boxMode === 'double-value') {
                        const secondaryBar = secondaryUsesColor ? undefined : (character.bars || []).find((item) => item.id === box.secondaryBarId);
                        const secondaryFill = secondaryUsesColor ? { fill: 100, current: 0, maxOrReset: 0 } : getBarFillDetail(secondaryBar, overviewContext);
                        const secondaryFillPercent = Math.round(secondaryFill.fill);
                        const secondaryColor = secondaryUsesColor ? (box.secondaryColor || '#a855f7') : (secondaryBar?.color || '#a855f7');
                        const entries = [
                          {
                            key: 'first',
                            value: getOverviewDisplayValue(box.valueId),
                            label: box.label || box.valueId || 'Value',
                            fill: primaryFill.fill,
                            fillPercent: primaryFillPercent,
                            color: primaryColor,
                            usesColor: primaryUsesColor,
                            title: primaryUsesColor ? 'Solid color' : `${primaryBar?.name || box.barId || 'No bar'}: ${primaryFill.current} / ${primaryFill.maxOrReset} (${primaryFillPercent}%)`,
                          },
                          {
                            key: 'second',
                            value: getOverviewDisplayValue(box.secondaryValueId || ''),
                            label: box.secondaryValueId || 'Value',
                            fill: secondaryFill.fill,
                            fillPercent: secondaryFillPercent,
                            color: secondaryColor,
                            usesColor: secondaryUsesColor,
                            title: secondaryUsesColor ? 'Solid color' : `${secondaryBar?.name || box.secondaryBarId || 'No bar'}: ${secondaryFill.current} / ${secondaryFill.maxOrReset} (${secondaryFillPercent}%)`,
                          },
                        ];
                        return (
                          <div key={box.id} className="grid grid-cols-2 gap-3">
                            {entries.map((entry) => (
                              <div
                                key={entry.key}
                                className="aspect-square overflow-hidden rounded-xl border-2 border-stone-950 bg-stone-950/75 shadow-[0_5px_0_rgba(0,0,0,0.32)]"
                                title={entry.title}
                              >
                                <div className="relative flex h-full flex-col items-center justify-center px-3 py-4 text-center">
                                  <div className="absolute inset-0 bg-gradient-to-r from-[#8d8562]/95 to-[#5f573d]/95" />
                                  <div
                                    className="absolute inset-x-0 bottom-0"
                                    style={{
                                      height: `${entry.fill}%`,
                                      background: `linear-gradient(0deg, ${entry.color}, ${entry.color}dd)`,
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-black/10" />
                                  <div className="relative z-10 text-2xl font-black text-white drop-shadow">{entry.value}</div>
                                  <div className="relative z-10 mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-stone-950">
                                    {entry.label}
                                  </div>
                                  {!entry.usesColor && entry.fillPercent > 0 && (
                                    <div className="absolute bottom-1 right-1 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                      {entry.fillPercent}%
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (boxMode === 'pip-counter') {
                        const pipCount = Math.max(1, Math.floor(box.pipCount || 4));
                        const filledPips = primaryFill.fill >= 100
                          ? pipCount
                          : Math.max(0, Math.min(pipCount, Math.floor(primaryFill.fill / (100 / pipCount))));
                        return (
                          <div
                            key={box.id}
                            className="overflow-hidden rounded-xl border-2 border-stone-950 bg-stone-950/75 shadow-[0_5px_0_rgba(0,0,0,0.32)]"
                            title={`${primaryBar?.name || box.barId || 'No bar'}: ${primaryFill.current} / ${primaryFill.maxOrReset} (${primaryFillPercent}%)`}
                          >
                            <div className="relative px-4 py-4">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#8d8562]/95 to-[#5f573d]/95" />
                              <div className="relative z-10 mb-3 text-center text-[10px] font-black uppercase tracking-[0.18em] text-stone-950">
                                {box.label || primaryBar?.name || 'Pips'}
                              </div>
                              <div className="relative z-10 flex justify-center gap-2">
                                {Array.from({ length: pipCount }).map((_, index) => (
                                  <span
                                    key={index}
                                    className="h-5 w-5 rounded-full border-2 border-stone-950 shadow-inner"
                                    style={{
                                      background: index < filledPips
                                        ? `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`
                                        : 'rgba(28, 25, 23, 0.65)',
                                    }}
                                  />
                                ))}
                              </div>
                              <div className="absolute bottom-1 right-2 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                {primaryFillPercent}%
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (boxMode === 'two-sided-pip') {
                        const secondaryBar = (character.bars || []).find((item) => item.id === box.secondaryBarId);
                        const secondaryFill = getBarFillDetail(secondaryBar, overviewContext);
                        const secondaryFillPercent = Math.round(secondaryFill.fill);
                        const secondaryColor = secondaryBar?.color || '#ef4444';
                        const leftPipCount = Math.max(1, Math.floor(box.pipCount || 4));
                        const rightPipCount = Math.max(1, Math.floor(box.secondaryPipCount || 4));
                        const leftFilledPips = primaryFill.fill >= 100
                          ? leftPipCount
                          : Math.max(0, Math.min(leftPipCount, Math.floor(primaryFill.fill / (100 / leftPipCount))));
                        const rightFilledPips = secondaryFill.fill >= 100
                          ? rightPipCount
                          : Math.max(0, Math.min(rightPipCount, Math.floor(secondaryFill.fill / (100 / rightPipCount))));
                        return (
                          <div
                            key={box.id}
                            className="overflow-hidden rounded-xl border-2 border-stone-950 bg-stone-950/75 shadow-[0_5px_0_rgba(0,0,0,0.32)]"
                            title={`${primaryBar?.name || box.barId || 'Left'}: ${primaryFill.current} / ${primaryFill.maxOrReset} (${primaryFillPercent}%) | ${secondaryBar?.name || box.secondaryBarId || 'Right'}: ${secondaryFill.current} / ${secondaryFill.maxOrReset} (${secondaryFillPercent}%)`}
                          >
                            <div className="relative px-3 py-4">
                              <div className="absolute inset-0 bg-gradient-to-r from-[#5f573d]/95 via-[#8d8562]/95 to-[#5f573d]/95" />
                              <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-stone-950/75" />
                              <div className="relative z-10 mb-3 text-center text-[10px] font-black uppercase tracking-[0.18em] text-stone-950">
                                {box.label || 'Two-Sided Pips'}
                              </div>
                              <div className="relative z-10 grid grid-cols-2 gap-5">
                                <div className="flex flex-row-reverse justify-start gap-1.5">
                                  {Array.from({ length: leftPipCount }).map((_, index) => (
                                    <span
                                      key={index}
                                      className="h-4 w-4 rounded-full border-2 border-stone-950 shadow-inner"
                                      style={{
                                        background: index < leftFilledPips
                                          ? `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`
                                          : 'rgba(28, 25, 23, 0.65)',
                                      }}
                                    />
                                  ))}
                                </div>
                                <div className="flex justify-start gap-1.5">
                                  {Array.from({ length: rightPipCount }).map((_, index) => (
                                    <span
                                      key={index}
                                      className="h-4 w-4 rounded-full border-2 border-stone-950 shadow-inner"
                                      style={{
                                        background: index < rightFilledPips
                                          ? `linear-gradient(135deg, ${secondaryColor}, ${secondaryColor}cc)`
                                          : 'rgba(28, 25, 23, 0.65)',
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                              <div className="absolute bottom-1 left-2 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                {primaryFillPercent}%
                              </div>
                              <div className="absolute bottom-1 right-2 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                {secondaryFillPercent}%
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const value = getOverviewDisplayValue(box.valueId);
                      return (
                        <div
                          key={box.id}
                          className="overflow-hidden rounded-xl border-2 border-stone-950 bg-stone-950/75 shadow-[0_5px_0_rgba(0,0,0,0.32)]"
                          title={primaryUsesColor ? 'Solid color' : `${primaryBar?.name || box.barId || 'No bar'}: ${primaryFill.current} / ${primaryFill.maxOrReset} (${primaryFillPercent}%)`}
                        >
                          <div className="relative px-4 py-3 text-center">
                            <div className="absolute inset-0 bg-gradient-to-r from-[#8d8562]/95 to-[#5f573d]/95" />
                            <div
                              className="absolute inset-y-0 left-0"
                              style={{
                                width: `${primaryFill.fill}%`,
                                background: `linear-gradient(90deg, ${primaryColor}, ${primaryColor}dd)`,
                              }}
                            />
                            {!primaryUsesColor && primaryFill.fill > 0 && primaryFill.fill < 100 && (
                              <div
                                className="absolute inset-y-0 w-[2px] bg-stone-950/65"
                                style={{ left: `calc(${primaryFill.fill}% - 1px)` }}
                              />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-black/10" />
                            <div className="relative z-10 text-2xl font-black text-white drop-shadow">{value}</div>
                            <div className="relative z-10 mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-950">
                              {box.label || box.valueId || 'Value'}
                            </div>
                            {!primaryUsesColor && primaryFill.maxOrReset !== 0 && (
                              <div className="absolute bottom-1 right-2 z-10 rounded bg-stone-950/70 px-1.5 py-0.5 text-[9px] font-black text-white">
                                {primaryFillPercent}%
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>
              </section>
            )}

            <section className="grid gap-5 md:grid-cols-3">
              {libraryCards.map((card) => (
                <button
                  key={card.category}
                  onClick={() => openLibrary(card.category, character.id)}
                  className="group rounded-2xl border border-amber-900/20 bg-white/45 p-6 text-left shadow-[0_18px_36px_rgba(68,38,17,0.12)] transition-all hover:-translate-y-0.5 hover:bg-white/65 hover:shadow-[0_24px_44px_rgba(68,38,17,0.16)] cursor-pointer"
                >
                  <div className="mb-5 inline-grid h-14 w-14 place-items-center rounded-2xl border border-amber-900/15 bg-white/55" style={{ color: card.accent }}>
                    {card.icon}
                  </div>
                  <h2 className="text-3xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{card.title}</h2>
                  <p className="mt-3 min-h-[72px] text-[15px] leading-6 text-stone-700">{card.subtitle}</p>
                  <div className="mt-5 flex items-center justify-between border-t border-amber-900/15 pt-4 text-sm text-amber-950">
                    <span>{card.count} entries</span>
                    <span className="transition-transform group-hover:translate-x-1">Open →</span>
                  </div>
                </button>
              ))}
              <button
                onClick={() => document.getElementById('homebrew-character-attributes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="group rounded-2xl border border-amber-900/20 bg-white/45 p-6 text-left shadow-[0_18px_36px_rgba(68,38,17,0.12)] transition-all hover:-translate-y-0.5 hover:bg-white/65 hover:shadow-[0_24px_44px_rgba(68,38,17,0.16)] cursor-pointer"
              >
                <div className="mb-5 inline-grid h-14 w-14 place-items-center rounded-2xl border border-amber-900/15 bg-white/55 text-sky-800">
                  <SlidersHorizontal size={28} />
                </div>
                <h2 className="text-3xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Attributes</h2>
                <p className="mt-3 min-h-[72px] text-[15px] leading-6 text-stone-700">
                  Main attributes, bars, skills, resistances, and custom values in one detailed view.
                </p>
                <div className="mt-5 flex items-center justify-between border-t border-amber-900/15 pt-4 text-sm text-amber-950">
                  <span>{overviewAttributes.length + (character.bars?.length || 0)} entries</span>
                  <span className="transition-transform group-hover:translate-x-1">View ↓</span>
                </div>
              </button>
            </section>

            <section id="homebrew-character-attributes" className={`${sectionClass} scroll-mt-6`}>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-amber-900/15 pb-4">
                <div>
                  <div className="mb-2 inline-flex rounded-full border border-sky-900/15 bg-sky-100/50 px-3 py-1 text-xs uppercase tracking-[0.24em] text-sky-950">
                    Attributes
                  </div>
                  <h2 className="text-4xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Character Attributes</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-700">
                    Detailed calculated values from this character sheet, grouped the same way as the editor.
                  </p>
                </div>
                <span className="rounded-full border border-amber-900/15 bg-white/50 px-3 py-1 text-sm text-stone-700">
                  {overviewAttributes.length + (character.bars?.length || 0)} total
                </span>
              </div>

              <div className="space-y-6">
                {attributeSections.map((section) => (
                  <div key={section.id} className="rounded-2xl border border-amber-900/15 bg-amber-50/35 p-4">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="text-2xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{section.title}</h3>
                        <p className="text-sm text-stone-600">{section.subtitle}</p>
                      </div>
                      <span className="rounded-full border border-amber-900/15 bg-white/50 px-2.5 py-1 text-xs text-stone-700">
                        {section.items.length}
                      </span>
                    </div>
                    {section.items.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-amber-900/20 bg-white/30 p-4 text-center text-sm italic text-stone-500">
                        No entries in this category.
                      </p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {section.items.map((attribute) => {
                          const displayValue = getAttributeDisplayValue(attribute, section.resistanceMode);
                          const numericValue = overviewContext[attribute.id] ?? 0;
                          const linkedMainAttribute = section.skillMode
                            ? (character.mainAttributes || []).find((item) => item.id === (attribute as SkillAttribute).linkedMainAttributeId)
                            : undefined;
                          return (
                            <div key={attribute.id} className="rounded-xl border border-amber-900/15 bg-white/45 p-4 shadow-sm">
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="truncate text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                                    {attribute.name || attribute.id}
                                  </h4>
                                  <p className="truncate text-xs text-stone-500">{attribute.id}</p>
                                </div>
                                <div className={`rounded-xl border px-3 py-2 text-xl font-black shadow-inner ${
                                  section.resistanceMode
                                    ? numericValue >= 0 ? 'border-emerald-900/20 bg-emerald-100/60 text-emerald-900' : 'border-rose-900/20 bg-rose-100/60 text-rose-900'
                                    : 'border-amber-900/20 bg-amber-100/65 text-amber-950'
                                }`}>
                                  {displayValue}
                                </div>
                              </div>
                              <div className="space-y-1 text-xs text-stone-600">
                                <p><strong>Base:</strong> {attribute.value || '0'}</p>
                                {section.id === 'main' && (
                                  <p><strong>Modifier:</strong> {formatSigned(overviewContext[`${attribute.id}_mod`] ?? 0)}</p>
                                )}
                                {section.skillMode && linkedMainAttribute && (
                                  <p><strong>Linked:</strong> {linkedMainAttribute.name || linkedMainAttribute.id}</p>
                                )}
                                {attribute.calculationType && attribute.calculationType !== 'sum' && (
                                  <p><strong>Calculation:</strong> {attribute.calculationType}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}

                <div className="rounded-2xl border border-amber-900/15 bg-amber-50/35 p-4">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="text-2xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Bars</h3>
                      <p className="text-sm text-stone-600">Current, max/reset, mode, and calculated fill values.</p>
                    </div>
                    <span className="rounded-full border border-amber-900/15 bg-white/50 px-2.5 py-1 text-xs text-stone-700">
                      {character.bars?.length || 0}
                    </span>
                  </div>
                  {!character.bars || character.bars.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-amber-900/20 bg-white/30 p-4 text-center text-sm italic text-stone-500">
                      No bars added yet.
                    </p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {character.bars.map((bar) => {
                        const fill = getBarFillDetail(bar, overviewContext);
                        const fillPercent = Math.round(fill.fill);
                        const color = bar.color || '#0ea5e9';
                        const mode = getBarMode(bar);
                        return (
                          <div key={bar.id} className="rounded-xl border border-amber-900/15 bg-white/45 p-4 shadow-sm">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="truncate text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                                  {bar.name || bar.id}
                                </h4>
                                <p className="truncate text-xs text-stone-500">{bar.id}</p>
                              </div>
                              <span className="rounded-full border border-amber-900/15 bg-white/55 px-2.5 py-1 text-xs capitalize text-stone-700">
                                {mode}
                              </span>
                            </div>
                            <div className="mb-2 flex items-center justify-between text-sm font-bold text-stone-700">
                              <span>{fill.current}</span>
                              <span>{mode === 'resource' ? 'Reset' : 'Max'}: {fill.maxOrReset}</span>
                            </div>
                            <div className="h-4 overflow-hidden rounded-full border border-stone-900/20 bg-stone-900/75">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${fill.fill}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }}
                              />
                            </div>
                            <p className="mt-2 text-right text-xs font-bold text-stone-600">{fillPercent}%</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default HomebrewCharacterSheetViewer;
