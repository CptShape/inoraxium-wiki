import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Backpack, Dices, FlaskConical, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react';
import { CharacterBar, CharacterData, CharacterLocalVariable, CustomAttribute, SkillAttribute, StatusEffect } from '../types/character';
import { loadCharacterById, loadUserDiceSettings, saveCharacter, UserDiceSettings } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { HomebrewLibraryCategory } from './HomebrewLibraryViewer';
import { getPixhostDirectImageUrl, isDirectImageUrl } from '../lib/pixhost';
import { QuickTools } from './QuickTools';
import { buildCharacterFormulaContext, buildLocalVariableContext, evalCharacterFormula, getCharacterBarMode } from '../lib/characterContext';

interface HomebrewCharacterSheetViewerProps {
  characterId: string;
  onBack?: () => void;
}

interface RollStep {
  label: string;
  value: number;
  detail?: string;
}

interface RollResult {
  macroName: string;
  formula: string;
  steps: RollStep[];
  total: number;
  timestamp: number;
  description?: string;
}

interface NumericInputRequest {
  title: string;
  description: string;
  defaultValue: string;
  currentLine?: string;
  submitLabel: string;
  showOverflowChoice?: boolean;
  resolve: (value: string | null) => void;
}

interface AttributeHistoryEntry {
  id: string;
  sourceType: 'base' | 'formula' | 'inventory-item' | 'general-item' | 'spell' | 'status';
  sourceId?: string;
  sourceName: string;
  detail: string;
  value: number;
  category?: HomebrewLibraryCategory;
  libraryKind?: string;
}

interface BarHistoryState {
  bar: CharacterBar;
  currentEntries: AttributeHistoryEntry[];
  limitEntries: AttributeHistoryEntry[];
  currentTotal: number;
  limitTotal: number;
  limitLabel: 'Max' | 'Reset';
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

const openLibraryEntry = (
  category: HomebrewLibraryCategory,
  characterId: string,
  kind: string,
  entryId: string,
) => {
  window.location.hash = `#homebrew-library/${category}/${encodeURIComponent(characterId)}/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}`;
};

const splitFormulaArgs = (argsString: string): string[] => {
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < argsString.length; i += 1) {
    const char = argsString[i];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(argsString.slice(start, i).trim());
      start = i + 1;
    }
  }

  args.push(argsString.slice(start).trim());
  return args;
};

const findFormulaFunctionCall = (expr: string, functionNames: string[]) => {
  const lower = expr.toLowerCase();

  for (let i = 0; i < expr.length; i += 1) {
    for (const functionName of functionNames) {
      const nameLength = functionName.length;
      if (lower.slice(i, i + nameLength) !== functionName) continue;
      const before = i > 0 ? expr[i - 1] : '';
      const after = expr[i + nameLength] || '';
      if (/[a-zA-Z0-9_]/.test(before) || after !== '(') continue;

      let depth = 0;
      for (let j = i + nameLength; j < expr.length; j += 1) {
        if (expr[j] === '(') depth += 1;
        if (expr[j] === ')') {
          depth -= 1;
          if (depth === 0) {
            return {
              start: i,
              end: j + 1,
              argsString: expr.slice(i + nameLength + 1, j),
            };
          }
        }
      }
    }
  }

  return null;
};

const normalizeFormulaConditionOperators = (expr: string): string => (
  expr
    .replace(/=</g, '<=')
    .replace(/=>/g, '>=')
    .replace(/(^|[^<>=!])=(?!=)/g, '$1===')
);

function transformIfFunctions(expr: string): string {
  let result = expr;
  let match = findFormulaFunctionCall(result, ['if']);

  while (match) {
    const args = splitFormulaArgs(match.argsString);
    if (args.length !== 3) return result;
    const condition = normalizeFormulaConditionOperators(transformIfFunctions(args[0]));
    result = `${result.slice(0, match.start)}((${condition}) ? (${transformIfFunctions(args[1])}) : (${transformIfFunctions(args[2])}))${result.slice(match.end)}`;
    match = findFormulaFunctionCall(result, ['if']);
  }

  return result;
}

const evalFormula = (
  formula: string,
  context: Record<string, number>,
  localContext: Record<string, number> = {},
): number => {
  if (!formula) return 0;

  let expr = formula.replace(/@@([a-zA-Z0-9_-]+)/g, (_match, id) => String(localContext[id] ?? 0));
  expr = expr
    .replace(/(^|[^@])@([a-zA-Z0-9_-]+)/g, (_match, prefix, id) => `${prefix}${context[id] ?? 0}`);
  expr = transformIfFunctions(expr);
  expr = expr
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

const getCharacterPortraitUrl = (character: CharacterData): string => {
  if (character.portraitUrl && isDirectImageUrl(character.portraitUrl)) return character.portraitUrl;
  const mainGalleryImage = (character.gallery || []).find(image => (image.tags || []).includes('main'));
  if (mainGalleryImage?.thumbUrl) return getPixhostDirectImageUrl(mainGalleryImage.url || mainGalleryImage.thumbUrl, mainGalleryImage.thumbUrl);
  return character.portraitUrl || '';
};

const getCharacterPortraitFallbackUrl = (character: CharacterData): string => (
  (character.gallery || []).find(image => (image.tags || []).includes('main'))?.thumbUrl || ''
);

const getGalleryDisplayUrl = (image: NonNullable<CharacterData['gallery']>[number]): string => (
  image.thumbUrl ? getPixhostDirectImageUrl(image.url || image.thumbUrl, image.thumbUrl) : image.url
);

const getCharacterSplashArtUrl = (character: CharacterData, fallbackUrl: string): string => {
  const splashArtImage = (character.gallery || []).find(image => (image.tags || []).includes('splash-art'));
  return splashArtImage ? getGalleryDisplayUrl(splashArtImage) : fallbackUrl;
};

const getCharacterSplashArtFallbackUrl = (character: CharacterData): string => (
  (character.gallery || []).find(image => (image.tags || []).includes('splash-art'))?.thumbUrl || getCharacterPortraitFallbackUrl(character)
);

const getLocalVariableContext = (
  variables: CharacterLocalVariable[] | undefined,
  globalContext: Record<string, number>,
) => {
  const localContext: Record<string, number> = {};
  (variables || []).forEach((variable) => {
    if (!variable.id) return;
    if (variable.kind === 'input') return;
    if (variable.kind === 'resource') {
      const parsed = Number.parseFloat(variable.value || '0');
      localContext[variable.id] = Number.isFinite(parsed) ? parsed : 0;
      return;
    }
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
    if (getCharacterBarMode(bar) === 'resource') {
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
      if (getCharacterBarMode(bar) === 'resource') {
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
  if (!bar?.id) return { fill: 0, overflow: 0, percent: 0, current: 0, maxOrReset: 0 };
  const current = context[`${bar.id}_current`] ?? 0;
  const maxOrReset = getCharacterBarMode(bar) === 'resource'
    ? context[`${bar.id}_reset`] ?? 0
    : context[`${bar.id}_max`] ?? 0;
  if (!maxOrReset) return { fill: 0, overflow: 0, percent: 0, current, maxOrReset };
  const calculatedPercent = Math.max(0, (current / maxOrReset) * 100);
  const rawPercent = getCharacterBarMode(bar) === 'resource' ? Math.min(100, calculatedPercent) : calculatedPercent;
  return {
    fill: Math.min(100, rawPercent),
    overflow: getCharacterBarMode(bar) === 'resource' ? 0 : Math.max(0, Math.min(100, rawPercent - 100)),
    percent: Math.round(rawPercent),
    current,
    maxOrReset,
  };
};

const getBarDisplayPercent = (fill: { fill: number; percent?: number }) => fill.percent ?? Math.round(fill.fill);

interface DiceRoll {
  notation: string;
  rolls: number[];
  sum: number;
}

const rollDice = (notation: string): DiceRoll => {
  const match = notation.match(/^(\d*)d(\d+)$/i);
  if (!match) throw new Error(`Invalid dice notation: ${notation}`);
  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  return { notation, rolls, sum: rolls.reduce((sum, value) => sum + value, 0) };
};

const sendToDiscord = async (webhookUrl: string, characterName: string, result: RollResult): Promise<string | null> => {
  try {
    const response = await fetch('https://ulunavir-vercel.vercel.app/api/send-dice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, characterName, result }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return data.error || `Server error ${response.status}`;
    return null;
  } catch {
    return 'Server connection error. Ensure the API route is deployed.';
  }
};

export const HomebrewCharacterSheetViewer: React.FC<HomebrewCharacterSheetViewerProps> = ({
  characterId,
  onBack,
}) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [diceSettings, setDiceSettings] = useState<UserDiceSettings>({ macros: [], webhookUrl: '', autoSend: false });
  const [rollPopupResult, setRollPopupResult] = useState<RollResult | null>(null);
  const [numericInputRequest, setNumericInputRequest] = useState<NumericInputRequest | null>(null);
  const [numericInputDraft, setNumericInputDraft] = useState('');
  const [numericInputError, setNumericInputError] = useState('');
  const [numericInputCanOverflow, setNumericInputCanOverflow] = useState(false);
  const [attributeHistory, setAttributeHistory] = useState<{
    attribute: CustomAttribute | SkillAttribute;
    entries: AttributeHistoryEntry[];
    total: number;
  } | null>(null);
  const [barHistory, setBarHistory] = useState<BarHistoryState | null>(null);
  const rollPopupTimeoutRef = useRef<number | null>(null);

  useEffect(() => authProvider.onAuthChange((state) => setUserId(state.uid)), []);

  useEffect(() => {
    if (!userId || userId === 'guest') return;
    loadUserDiceSettings(userId).then(setDiceSettings).catch(() => undefined);
  }, [userId]);

  const dismissRollPopup = useCallback(() => {
    if (rollPopupTimeoutRef.current) {
      window.clearTimeout(rollPopupTimeoutRef.current);
      rollPopupTimeoutRef.current = null;
    }
    setRollPopupResult(null);
  }, []);

  const showRollPopup = useCallback((result: RollResult) => {
    setRollPopupResult(result);
    if (rollPopupTimeoutRef.current) {
      window.clearTimeout(rollPopupTimeoutRef.current);
    }
    rollPopupTimeoutRef.current = window.setTimeout(() => {
      setRollPopupResult(null);
      rollPopupTimeoutRef.current = null;
    }, 10000);
  }, []);

  useEffect(() => () => {
    if (rollPopupTimeoutRef.current) window.clearTimeout(rollPopupTimeoutRef.current);
  }, []);

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
  const overviewContext = character ? buildCharacterFormulaContext(character) : {};
  const canControlCharacter = !!character && (
    !character.userId
    || character.userId === 'guest'
    || (!!userId && (character.userId === userId || (character.controlUserIds || []).includes(userId)))
  );

  const requestNumericInput = (
    title: string,
    description: string,
    defaultValue = '',
    submitLabel = 'OK',
    currentLine?: string,
    showOverflowChoice = false,
  ): Promise<string | null> => (
    new Promise((resolve) => {
      setNumericInputDraft(defaultValue);
      setNumericInputError('');
      setNumericInputCanOverflow(false);
      setNumericInputRequest({
        title,
        description,
        defaultValue,
        currentLine,
        submitLabel,
        showOverflowChoice,
        resolve: (value) => {
          setNumericInputRequest(null);
          setNumericInputError('');
          resolve(value);
        },
      });
    })
  );

  const executeOverviewRoll = async (name: string, formula: string, description?: string) => {
    if (!character) return;
    const context = buildCharacterFormulaContext(character);
    const steps: RollStep[] = [];
    const resolvedParts: string[] = [];

    formula.split(/(\d*d\d+|@[a-zA-Z0-9_-]+)/gi).forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      if (/^(\d*)d(\d+)$/i.test(trimmed)) {
        const dice = rollDice(trimmed);
        steps.push({ label: trimmed, value: dice.sum, detail: dice.rolls.join(', ') });
        resolvedParts.push(String(dice.sum));
        return;
      }
      const refMatch = trimmed.match(/^@([a-zA-Z0-9_-]+)$/);
      if (refMatch) {
        const refId = refMatch[1];
        const value = context[refId] ?? 0;
        steps.push({ label: `@${refId}`, value, detail: `${refId} = ${value}` });
        resolvedParts.push(String(value));
        return;
      }
      resolvedParts.push(trimmed);
    });

    const total = evalCharacterFormula(resolvedParts.join(' '), {});
    const result: RollResult = {
      macroName: name,
      formula,
      steps,
      total,
      timestamp: Date.now(),
      description,
    };
    showRollPopup(result);

    if (diceSettings.autoSend) {
      const discordErr = await sendToDiscord(diceSettings.webhookUrl || '', character.name || characterId, result);
      setActionMessage(discordErr ? `Discord: ${discordErr}` : null);
    }
  };

  const rollAttributeCard = (attribute: CustomAttribute) => {
    void executeOverviewRoll(
      `${attribute.name || attribute.id} Check`,
      `1d20 + @${attribute.id}_mod`,
      `${attribute.name || attribute.id} attribute check`,
    );
  };

  const rollSkillCard = (skill: SkillAttribute) => {
    void executeOverviewRoll(
      `${skill.name || skill.id} Check`,
      `1d20 + @${skill.id}`,
      `${skill.name || skill.id} skill check`,
    );
  };

  const rollResistanceCard = async (attribute: CustomAttribute | SkillAttribute) => {
    const rawInput = await requestNumericInput(
      `${attribute.name || attribute.id} Resistance`,
      `Enter incoming value. The result will be reduced by ${getAttributeDisplayValue(attribute, true)}.`,
      '0',
      'Roll',
    );
    if (rawInput === null) return;
    const inputValue = Number.parseFloat(rawInput.replace(',', '.'));
    if (!Number.isFinite(inputValue)) return;
    const percentage = overviewContext[attribute.id] ?? 0;
    const total = Math.round(inputValue * (percentage / 100) * 100) / 100;
    const result: RollResult = {
      macroName: `${attribute.name || attribute.id} Resistance`,
      formula: `${inputValue} * ${percentage}%`,
      steps: [
        { label: 'Input', value: inputValue },
        { label: `${attribute.id}`, value: percentage, detail: `${percentage}%` },
      ],
      total,
      timestamp: Date.now(),
      description: `${inputValue} reduced by ${percentage}%`,
    };
    showRollPopup(result);

    if (diceSettings.autoSend && character) {
      const discordErr = await sendToDiscord(diceSettings.webhookUrl || '', character.name || characterId, result);
      setActionMessage(discordErr ? `Discord: ${discordErr}` : null);
    }
  };

  const updateBarCurrent = async (bar: CharacterBar) => {
    if (!character || !canControlCharacter) return;
    const fill = getBarFillDetail(bar, overviewContext);
    const rawInput = await requestNumericInput(
      `${bar.name || bar.id} Update`,
      'Use +100 or -100 to change current value. Use =100 to set the displayed current value directly.',
      '',
      'OK',
      `${fill.current} / ${fill.maxOrReset}`,
      getCharacterBarMode(bar) === 'default',
    );
    if (rawInput === null) return;

    const trimmed = rawInput.trim().replace(',', '.');
    if (!/^[=+\-]?\d+(?:\.\d+)?$/.test(trimmed)) {
      setActionMessage('Invalid bar update value.');
      return;
    }

    const context = buildCharacterFormulaContext(character);
    const rawCurrent = evalCharacterFormula(bar.currentValue || '0', context);
    const displayedCurrent = context[`${bar.id}_current`] ?? rawCurrent;
    const contribution = displayedCurrent - rawCurrent;
    const amount = Number.parseFloat(trimmed.replace(/^[=+]/, ''));
    const nextUnclampedRawCurrent = trimmed.startsWith('=')
      ? amount - contribution
      : rawCurrent + amount;
    const max = getCharacterBarMode(bar) === 'resource' ? 0 : evalCharacterFormula(bar.maxValue || '0', context);
    const nextDisplayedCurrent = nextUnclampedRawCurrent + contribution;
    const nextRawCurrent = getCharacterBarMode(bar) === 'default'
      && !numericInputCanOverflow
      && Number.isFinite(max)
      && max > 0
      && nextDisplayedCurrent > max
      ? max - contribution
      : nextUnclampedRawCurrent;

    const nextCharacter = {
      ...character,
      bars: (character.bars || []).map((entry) => (
        entry.id === bar.id
          ? { ...entry, currentValue: `${Math.round(nextRawCurrent * 100) / 100}` }
          : entry
      )),
    };
    setCharacter(nextCharacter);
    const saveResult = await saveCharacter(nextCharacter);
    setActionMessage(saveResult.localSaved || saveResult.remoteSaved ? `${bar.name || bar.id} updated.` : 'Bar update could not be saved.');
  };
  const portraitUrl = character ? getCharacterPortraitUrl(character) : '';
  const splashArtUrl = character ? getCharacterSplashArtUrl(character, portraitUrl) : '';
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
  const buildAttributeHistory = (attribute: CustomAttribute | SkillAttribute): AttributeHistoryEntry[] => {
    if (!character) return [];
    const baseContext = buildCharacterFormulaContext({
      ...character,
      statuses: [],
      generalItems: [],
      inventory: [],
      spells: [],
    });
    const entries: AttributeHistoryEntry[] = [{
      id: `base:${attribute.id}`,
      sourceType: 'base',
      sourceName: attribute.name || attribute.id,
      detail: 'Base value',
      value: baseContext[attribute.id] ?? evalCharacterFormula(attribute.value || '0', baseContext),
    }];
    const context = buildCharacterFormulaContext(character);

    const pushEffects = (
      sourceType: AttributeHistoryEntry['sourceType'],
      sourceId: string | undefined,
      sourceName: string,
      effects: StatusEffect[] | undefined,
      localVariables: CharacterLocalVariable[] | undefined,
      detailPrefix: string,
      category?: HomebrewLibraryCategory,
      libraryKind?: string,
    ) => {
      const localContext = buildLocalVariableContext(localVariables, context);
      (effects || []).forEach((effect, effectIndex) => {
        if (effect.effectType && effect.effectType !== 'attribute') return;
        if ((effect.active ?? true) === false || effect.targetId !== attribute.id) return;
        entries.push({
          id: `${sourceType}:${sourceId || 'unknown'}:${effect.id || effectIndex}`,
          sourceType,
          sourceId,
          sourceName,
          detail: `${detailPrefix}: ${effect.value || '0'}`,
          value: evalCharacterFormula(effect.value || '0', context, localContext),
          category,
          libraryKind,
        });
      });
    };

    (character.statuses || []).forEach((status) => {
      if ((status.active ?? true) === false) return;
      pushEffects('status', status.id, status.name || status.id, status.effects, status.localVariables, 'Status effect', 'statuses', 'status');
      (status.actions || []).forEach((action) => {
        pushEffects('status', status.id, status.name || status.id, action.effects, status.localVariables, `Action: ${action.name || action.id}`, 'statuses', 'status');
      });
    });

    (character.inventory || []).forEach((item) => {
      if (!item.equipped) return;
      pushEffects('inventory-item', item.id, item.name || item.id, item.effects, item.localVariables, 'Item effect', 'inventory', 'inventory-item');
      (item.actions || []).forEach((action) => {
        pushEffects('inventory-item', item.id, item.name || item.id, action.effects, item.localVariables, `Action: ${action.name || action.id}`, 'inventory', 'inventory-item');
      });
    });

    (character.generalItems || []).forEach((item) => {
      if (!item.equipped) return;
      pushEffects('general-item', item.id, item.name || item.id, item.effects, item.localVariables, 'General item effect', 'inventory', 'general-item');
      (item.actions || []).forEach((action) => {
        pushEffects('general-item', item.id, item.name || item.id, action.effects, item.localVariables, `Action: ${action.name || action.id}`, 'inventory', 'general-item');
      });
    });

    (character.spells || []).forEach((spell) => {
      (spell.actions || []).forEach((action) => {
        pushEffects('spell', spell.id, spell.name || spell.id, action.effects, spell.localVariables, `Action: ${action.name || action.id}`, 'spells', 'spell');
      });
    });

    return entries;
  };
  const openAttributeHistory = (attribute: CustomAttribute | SkillAttribute) => {
    const entries = buildAttributeHistory(attribute);
    setAttributeHistory({
      attribute,
      entries,
      total: overviewContext[attribute.id] ?? 0,
    });
  };
  const getFormulaReferenceIds = (formula?: string) => {
    const ids = new Set<string>();
    Array.from((formula || '').matchAll(/(^|[^@])@([a-zA-Z0-9_-]+)/g)).forEach((match) => {
      if (match[2]) ids.add(match[2]);
    });
    return Array.from(ids);
  };
  const collectEffectHistoryForTargets = (
    targetIds: string[],
    context: Record<string, number>,
  ): AttributeHistoryEntry[] => {
    if (!character || targetIds.length === 0) return [];
    const targetSet = new Set(targetIds);
    const entries: AttributeHistoryEntry[] = [];

    const pushEffects = (
      sourceType: AttributeHistoryEntry['sourceType'],
      sourceId: string | undefined,
      sourceName: string,
      effects: StatusEffect[] | undefined,
      localVariables: CharacterLocalVariable[] | undefined,
      detailPrefix: string,
      category?: HomebrewLibraryCategory,
      libraryKind?: string,
    ) => {
      const localContext = buildLocalVariableContext(localVariables, context);
      (effects || []).forEach((effect, effectIndex) => {
        if (effect.effectType && effect.effectType !== 'attribute') return;
        if ((effect.active ?? true) === false || !targetSet.has(effect.targetId)) return;
        entries.push({
          id: `${sourceType}:${sourceId || 'unknown'}:${effect.targetId}:${effect.id || effectIndex}`,
          sourceType,
          sourceId,
          sourceName,
          detail: `${detailPrefix} -> ${effect.targetId}: ${effect.value || '0'}`,
          value: evalCharacterFormula(effect.value || '0', context, localContext),
          category,
          libraryKind,
        });
      });
    };

    (character.statuses || []).forEach((status) => {
      if ((status.active ?? true) === false) return;
      pushEffects('status', status.id, status.name || status.id, status.effects, status.localVariables, 'Status effect', 'statuses', 'status');
      (status.actions || []).forEach(action => (
        pushEffects('status', status.id, status.name || status.id, action.effects, status.localVariables, `Action: ${action.name || action.id}`, 'statuses', 'status')
      ));
    });
    (character.inventory || []).forEach((item) => {
      if (!item.equipped) return;
      pushEffects('inventory-item', item.id, item.name || item.id, item.effects, item.localVariables, 'Item effect', 'inventory', 'inventory-item');
      (item.actions || []).forEach(action => (
        pushEffects('inventory-item', item.id, item.name || item.id, action.effects, item.localVariables, `Action: ${action.name || action.id}`, 'inventory', 'inventory-item')
      ));
    });
    (character.generalItems || []).forEach((item) => {
      if (!item.equipped) return;
      pushEffects('general-item', item.id, item.name || item.id, item.effects, item.localVariables, 'General item effect', 'inventory', 'general-item');
      (item.actions || []).forEach(action => (
        pushEffects('general-item', item.id, item.name || item.id, action.effects, item.localVariables, `Action: ${action.name || action.id}`, 'inventory', 'general-item')
      ));
    });
    (character.spells || []).forEach((spell) => {
      (spell.actions || []).forEach(action => (
        pushEffects('spell', spell.id, spell.name || spell.id, action.effects, spell.localVariables, `Action: ${action.name || action.id}`, 'spells', 'spell')
      ));
    });

    return entries;
  };
  const buildValueHistory = (valueId: string, seen = new Set<string>()): AttributeHistoryEntry[] => {
    if (!character || seen.has(valueId)) return [];
    seen.add(valueId);

    const attribute = overviewAttributes.find(attr => attr.id === valueId);
    if (attribute) return buildAttributeHistory(attribute);

    const modMatch = valueId.match(/^(.+)_mod$/);
    if (modMatch) {
      const sourceAttribute = (character.mainAttributes || []).find(attr => attr.id === modMatch[1]);
      const entries: AttributeHistoryEntry[] = [{
        id: `formula:${valueId}`,
        sourceType: 'formula',
        sourceName: `@${valueId}`,
        detail: sourceAttribute ? `Modifier from ${sourceAttribute.name || sourceAttribute.id}` : 'Calculated modifier',
        value: overviewContext[valueId] ?? 0,
      }];
      if (sourceAttribute) entries.push(...buildAttributeHistory(sourceAttribute));
      entries.push(...collectEffectHistoryForTargets([valueId], overviewContext));
      return entries;
    }

    const referencedBar = (character.bars || []).find(bar => (
      valueId === `${bar.id}_current` || valueId === `${bar.id}_max` || valueId === `${bar.id}_reset`
    ));
    if (referencedBar) {
      const formula = valueId.endsWith('_current')
        ? referencedBar.currentValue
        : valueId.endsWith('_reset')
          ? referencedBar.resetValue
          : referencedBar.maxValue;
      return buildBarValueHistory(referencedBar, valueId, formula || '0', seen);
    }

    return collectEffectHistoryForTargets([valueId], overviewContext);
  };
  const buildBarValueHistory = (
    bar: CharacterBar,
    valueId: string,
    formula: string,
    seen = new Set<string>(),
  ): AttributeHistoryEntry[] => {
    const entries: AttributeHistoryEntry[] = [{
      id: `base:${valueId}`,
      sourceType: 'base',
      sourceName: bar.name || bar.id,
      detail: `${valueId}: ${formula || '0'}`,
      value: overviewContext[valueId] ?? evalCharacterFormula(formula || '0', overviewContext),
    }];
    getFormulaReferenceIds(formula).forEach((refId) => {
      buildValueHistory(refId, new Set(seen)).forEach((entry) => {
        entries.push({
          ...entry,
          id: `${valueId}:ref:${refId}:${entry.id}`,
          detail: `via @${refId} - ${entry.detail}`,
        });
      });
    });
    entries.push(...collectEffectHistoryForTargets([valueId], overviewContext));
    return entries;
  };
  const openBarHistory = (bar: CharacterBar) => {
    const mode = getCharacterBarMode(bar);
    const limitId = mode === 'resource' ? `${bar.id}_reset` : `${bar.id}_max`;
    setBarHistory({
      bar,
      currentEntries: buildBarValueHistory(bar, `${bar.id}_current`, bar.currentValue || '0'),
      limitEntries: buildBarValueHistory(bar, limitId, mode === 'resource' ? (bar.resetValue || '0') : (bar.maxValue || '0')),
      currentTotal: overviewContext[`${bar.id}_current`] ?? 0,
      limitTotal: overviewContext[limitId] ?? 0,
      limitLabel: mode === 'resource' ? 'Reset' : 'Max',
    });
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
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] p-6 pr-24 text-stone-900" style={parchmentBackground}>
      <QuickTools character={character} canControl={canControlCharacter} onCharacterUpdated={setCharacter} />
      {rollPopupResult && (
        <button
          type="button"
          onClick={dismissRollPopup}
          className="fixed bottom-5 right-24 z-[9999] w-[min(360px,calc(100vw-7rem))] rounded-2xl border border-cyan-500/50 bg-stone-950/95 p-4 text-left text-cyan-50 shadow-[0_22px_60px_rgba(0,0,0,0.45)] backdrop-blur transition hover:border-cyan-300"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-cyan-300">
                <Dices size={14} /> Roll Result
              </div>
              <h3 className="mt-1 truncate text-lg font-bold text-white" style={{ fontFamily: "'Cinzel', serif" }}>
                {rollPopupResult.macroName}
              </h3>
            </div>
            <span className="rounded-xl border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-2xl font-black text-amber-100">
              {rollPopupResult.total}
            </span>
          </div>
          <code className="block rounded-lg border border-cyan-500/20 bg-black/35 px-3 py-2 text-xs text-cyan-100">
            {rollPopupResult.formula}
          </code>
          {rollPopupResult.description && (
            <p className="mt-2 text-xs leading-5 text-cyan-100/75">{rollPopupResult.description}</p>
          )}
          {rollPopupResult.steps.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-cyan-50/80">
              {rollPopupResult.steps.map((step, index) => (
                <div key={`${step.label}-${index}`} className="flex items-center justify-between gap-3">
                  <span className="truncate">{step.label}{step.detail ? ` (${step.detail})` : ''}</span>
                  <strong className="text-cyan-100">{step.value}</strong>
                </div>
              ))}
            </div>
          )}
        </button>
      )}
      {numericInputRequest && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-700/50 bg-stone-950 p-5 text-cyan-50 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <h3 className="text-2xl text-white" style={{ fontFamily: "'Cinzel', serif" }}>
              {numericInputRequest.title}
            </h3>
            {numericInputRequest.currentLine && (
              <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-2xl font-black text-amber-100">
                {numericInputRequest.currentLine}
              </div>
            )}
            <p className="mt-3 text-sm leading-6 text-cyan-100/75">{numericInputRequest.description}</p>
            <input
              autoFocus
              value={numericInputDraft}
              onChange={(event) => {
                setNumericInputDraft(event.target.value.replace(',', '.').replace(/[^\d.=+\-]/g, ''));
                setNumericInputError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  numericInputRequest.resolve(null);
                }
                if (event.key === 'Enter') {
                  const value = numericInputDraft.trim();
                  if (!value) {
                    setNumericInputError('Please enter a value.');
                    return;
                  }
                  numericInputRequest.resolve(value);
                }
              }}
              className="mt-4 w-full rounded-xl border border-cyan-600/45 bg-black/40 px-4 py-3 text-lg text-white outline-none focus:border-cyan-300"
              placeholder="100, +100, -100, =100"
            />
            {numericInputRequest.showOverflowChoice && (
              <label className="mt-3 block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Overflow</span>
                <select
                  value={numericInputCanOverflow ? 'can' : 'cant'}
                  onChange={(event) => setNumericInputCanOverflow(event.target.value === 'can')}
                  className="w-full rounded-xl border border-cyan-600/35 bg-black/40 px-4 py-3 text-sm text-cyan-50 outline-none focus:border-cyan-300"
                >
                  <option value="cant">Can't Overflow</option>
                  <option value="can">Can Overflow</option>
                </select>
              </label>
            )}
            {numericInputError && <p className="mt-2 text-sm text-rose-300">{numericInputError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => numericInputRequest.resolve(null)}
                className="rounded-lg border border-cyan-700/40 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-950/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const value = numericInputDraft.trim();
                  if (!value) {
                    setNumericInputError('Please enter a value.');
                    return;
                  }
                  numericInputRequest.resolve(value);
                }}
                className="rounded-lg border border-cyan-400/50 bg-cyan-600/85 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500"
              >
                {numericInputRequest.submitLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {attributeHistory && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
          onClick={() => setAttributeHistory(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-amber-600/45 bg-stone-950 p-5 text-amber-50 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-amber-300">Value History</div>
                <h3 className="mt-1 text-2xl text-white" style={{ fontFamily: "'Cinzel', serif" }}>
                  {attributeHistory.attribute.name || attributeHistory.attribute.id}
                </h3>
                <p className="mt-1 text-sm text-amber-100/70">{attributeHistory.attribute.id}</p>
              </div>
              <div className="rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-2xl font-black text-cyan-100">
                {attributeHistory.total}
              </div>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {attributeHistory.entries.map((entry) => {
                const clickable = !!entry.category && !!entry.libraryKind && !!entry.sourceId && character;
                const content = (
                  <>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-amber-50">{entry.sourceName}</div>
                      <div className="truncate text-xs text-amber-100/60">{entry.detail}</div>
                    </div>
                    <div className="shrink-0 rounded-lg border border-amber-500/25 bg-black/25 px-3 py-1 text-sm font-black text-amber-100">
                      {formatSigned(entry.value)}
                    </div>
                  </>
                );
                return clickable ? (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setAttributeHistory(null);
                      openLibraryEntry(entry.category!, character!.id, entry.libraryKind!, entry.sourceId!);
                    }}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-amber-800/30 bg-white/5 px-4 py-3 text-left transition hover:border-cyan-400/45 hover:bg-cyan-950/25"
                  >
                    {content}
                  </button>
                ) : (
                  <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-amber-800/20 bg-white/5 px-4 py-3">
                    {content}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setAttributeHistory(null)}
                className="rounded-lg border border-amber-700/40 px-4 py-2 text-sm text-amber-100 hover:bg-amber-950/50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {barHistory && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
          onClick={() => setBarHistory(null)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-sky-600/45 bg-stone-950 p-5 text-sky-50 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-sky-300">Bar History</div>
                <h3 className="mt-1 text-2xl text-white" style={{ fontFamily: "'Cinzel', serif" }}>
                  {barHistory.bar.name || barHistory.bar.id}
                </h3>
                <p className="mt-1 text-sm text-sky-100/70">{barHistory.bar.id}</p>
              </div>
              <div className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-2 text-xl font-black text-amber-100">
                {barHistory.currentTotal} / {barHistory.limitTotal}
              </div>
            </div>
            <div className="grid max-h-[64vh] gap-4 overflow-y-auto pr-1 lg:grid-cols-2">
              {[
                { title: 'Current', entries: barHistory.currentEntries, total: barHistory.currentTotal },
                { title: barHistory.limitLabel, entries: barHistory.limitEntries, total: barHistory.limitTotal },
              ].map((column) => (
                <div key={column.title} className="rounded-2xl border border-sky-800/30 bg-white/5 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-sky-800/25 pb-2">
                    <h4 className="font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{column.title}</h4>
                    <span className="rounded-lg border border-sky-400/25 bg-black/25 px-3 py-1 text-sm font-black">{column.total}</span>
                  </div>
                  <div className="space-y-2">
                    {column.entries.map((entry) => {
                      const clickable = !!entry.category && !!entry.libraryKind && !!entry.sourceId && character;
                      const content = (
                        <>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-sky-50">{entry.sourceName}</div>
                            <div className="truncate text-xs text-sky-100/60">{entry.detail}</div>
                          </div>
                          <div className="shrink-0 rounded-lg border border-sky-500/25 bg-black/25 px-3 py-1 text-sm font-black text-sky-100">
                            {formatSigned(entry.value)}
                          </div>
                        </>
                      );
                      return clickable ? (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => {
                            setBarHistory(null);
                            openLibraryEntry(entry.category!, character!.id, entry.libraryKind!, entry.sourceId!);
                          }}
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-sky-800/30 bg-white/5 px-4 py-3 text-left transition hover:border-amber-400/45 hover:bg-amber-950/25"
                        >
                          {content}
                        </button>
                      ) : (
                        <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-sky-800/20 bg-white/5 px-4 py-3">
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setBarHistory(null)}
                className="rounded-lg border border-sky-700/40 px-4 py-2 text-sm text-sky-100 hover:bg-sky-950/50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
            {actionMessage && (
              <div className="rounded-2xl border border-amber-900/20 bg-white/55 px-4 py-3 text-sm font-semibold text-amber-950 shadow-sm">
                {actionMessage}
              </div>
            )}
            <section className={`${sectionClass} relative overflow-hidden`}>
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-800 via-amber-600 to-transparent" />
              <div className="grid gap-6 md:grid-cols-[140px_1fr] md:items-center">
                <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-3xl border border-amber-900/25 bg-amber-100/45 text-amber-900 shadow-inner">
                  {portraitUrl ? (
                    <img
                      src={portraitUrl}
                      alt={character.name}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        const fallbackUrl = getCharacterPortraitFallbackUrl(character);
                        if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                          event.currentTarget.src = fallbackUrl;
                        }
                      }}
                    />
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
                  {splashArtUrl ? (
                    <>
                      <img
                        src={splashArtUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full scale-105 object-cover opacity-25 blur-xl"
                        onError={(event) => {
                          const fallbackUrl = getCharacterSplashArtFallbackUrl(character);
                          if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                            event.currentTarget.src = fallbackUrl;
                          }
                        }}
                      />
                      <img
                        src={splashArtUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-contain object-center opacity-95"
                        onError={(event) => {
                          const fallbackUrl = getCharacterSplashArtFallbackUrl(character);
                          if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                            event.currentTarget.src = fallbackUrl;
                          }
                        }}
                      />
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
                      const primaryFillPercent = getBarDisplayPercent(primaryFill);
                      const primaryColor = primaryUsesColor ? (box.color || '#0ea5e9') : (primaryBar?.color || '#0ea5e9');

                      if (boxMode === 'two-sided') {
                        const secondaryBar = secondaryUsesColor ? undefined : (character.bars || []).find((item) => item.id === box.secondaryBarId);
                        const secondaryFill = secondaryUsesColor ? { fill: 100, current: 0, maxOrReset: 0 } : getBarFillDetail(secondaryBar, overviewContext);
                        const secondaryFillPercent = getBarDisplayPercent(secondaryFill);
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
                        const secondaryFillPercent = getBarDisplayPercent(secondaryFill);
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
                        const secondaryFillPercent = getBarDisplayPercent(secondaryFill);
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
                          const isClickable = section.id === 'main' || section.skillMode || section.resistanceMode;
                          const cardClassName = `rounded-xl border border-amber-900/15 bg-white/45 p-4 text-left shadow-sm ${
                            isClickable
                              ? 'cursor-pointer transition hover:-translate-y-0.5 hover:border-cyan-700/35 hover:bg-white/65 hover:shadow-md'
                              : ''
                          }`;
                          const cardContent = (
                            <>
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
                            </>
                          );
                          if (!isClickable) {
                            return (
                              <div
                                key={attribute.id}
                                className={cardClassName}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  openAttributeHistory(attribute);
                                }}
                              >
                                {cardContent}
                              </div>
                            );
                          }
                          return (
                              <button
                              key={attribute.id}
                              type="button"
                              onClick={() => {
                                if (section.id === 'main') {
                                  rollAttributeCard(attribute as CustomAttribute);
                                  return;
                                }
                                if (section.skillMode) {
                                  rollSkillCard(attribute as SkillAttribute);
                                  return;
                                }
                                if (section.resistanceMode) {
                                  void rollResistanceCard(attribute);
                                }
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                openAttributeHistory(attribute);
                              }}
                              className={cardClassName}
                              title={section.resistanceMode ? 'Roll resistance value' : 'Roll check'}
                            >
                              {cardContent}
                            </button>
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
                        const fillPercent = getBarDisplayPercent(fill);
                        const color = bar.color || '#0ea5e9';
                        const overflowColor = (bar.useDefaultOverflowColor ?? true) ? color : (bar.overflowColor || '#f97316');
                        const mode = getCharacterBarMode(bar);
                        return (
                          <button
                            key={bar.id}
                            type="button"
                            onClick={() => void updateBarCurrent(bar)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openBarHistory(bar);
                            }}
                            aria-disabled={!canControlCharacter}
                            className={`rounded-xl border border-amber-900/15 bg-white/45 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-700/35 hover:bg-white/65 hover:shadow-md ${canControlCharacter ? '' : 'opacity-80'}`}
                            title={canControlCharacter ? 'Update bar current value' : 'Control access is required'}
                          >
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
                            <div className="relative h-4 overflow-hidden rounded-full border border-stone-900/20 bg-stone-900/75">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full"
                                style={{ width: `${fill.fill}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }}
                              />
                              {fill.overflow > 0 && (
                                <div
                                  className="absolute inset-y-0 right-0"
                                  style={{ width: `${fill.overflow}%`, background: `linear-gradient(90deg, ${overflowColor}dd, ${overflowColor})` }}
                                />
                              )}
                            </div>
                            <p className="mt-2 text-right text-xs font-bold text-stone-600">{fillPercent}%</p>
                          </button>
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
