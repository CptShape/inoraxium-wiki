import {
  CharacterBar,
  CharacterData,
  CharacterGeneralItem,
  CharacterLocalVariable,
  CustomAttribute,
  SkillAttribute,
} from '../types/character';

type AttributeCalculationType = NonNullable<CustomAttribute['calculationType']>;

const DEFAULT_ATTRIBUTE_CALCULATION_TYPE: AttributeCalculationType = 'sum';

export const getCharacterBarMode = (bar: Partial<CharacterBar>): NonNullable<CharacterBar['mode']> => bar.mode || 'default';

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
              name: functionName,
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

const transformIfFunctions = (expr: string): string => {
  let result = expr;
  let match = findFormulaFunctionCall(result, ['if']);

  while (match) {
    const args = splitFormulaArgs(match.argsString);
    if (args.length !== 3) return result;
    const condition = normalizeFormulaConditionOperators(transformIfFunctions(args[0]));
    const whenTrue = transformIfFunctions(args[1]);
    const whenFalse = transformIfFunctions(args[2]);
    result = `${result.slice(0, match.start)}((${condition}) ? (${whenTrue}) : (${whenFalse}))${result.slice(match.end)}`;
    match = findFormulaFunctionCall(result, ['if']);
  }

  return result;
};

export const evalCharacterFormula = (
  formula: string,
  context: Record<string, number>,
  localContext: Record<string, number> = {},
): number => {
  if (!formula) return 0;

  let expr = formula.replace(/@@([a-zA-Z0-9_-]+)/g, (_match, refId) => (
    (localContext[refId] ?? 0).toString()
  ));

  expr = expr.replace(/(^|[^@])@([a-zA-Z0-9_-]+)/g, (_match, prefix, refId) => (
    `${prefix}${(context[refId] ?? 0).toString()}`
  ));

  expr = transformIfFunctions(expr);

  expr = expr
    .replace(/roundup/g, 'Math.ceil')
    .replace(/rounddown/g, 'Math.floor')
    .replace(/round/g, 'Math.round')
    .replace(/max/g, 'Math.max')
    .replace(/min/g, 'Math.min');

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    return typeof result === 'number' && Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};

export const normalizeCharacterLocalVariables = (variables?: CharacterLocalVariable[]): CharacterLocalVariable[] => (
  Array.isArray(variables)
    ? variables.map(variable => ({
      id: variable.id || '',
      description: variable.description || '',
      value: variable.value || '0',
      kind: variable.kind === 'input' || variable.kind === 'resource' ? variable.kind : 'variable',
      replenishTrigger: variable.replenishTrigger || 'custom',
      replenishMode: variable.replenishMode === 'set' ? 'set' : 'gain',
      replenishAmount: variable.replenishAmount || '0',
      maxValue: variable.maxValue || '',
    }))
    : []
);

export const buildLocalVariableContext = (
  variables: CharacterLocalVariable[] | undefined,
  globalContext: Record<string, number> = {},
): Record<string, number> => {
  const localContext: Record<string, number> = {};
  normalizeCharacterLocalVariables(variables).forEach((variable) => {
    if (!variable.id || variable.kind === 'input') return;
    if (variable.kind === 'resource') {
      const parsed = Number.parseFloat(variable.value || '0');
      localContext[variable.id] = Number.isFinite(parsed) ? parsed : 0;
      return;
    }
    localContext[variable.id] = evalCharacterFormula(variable.value || '0', globalContext, localContext);
  });
  return localContext;
};

const normalizeGeneralItemForContext = (item: CharacterGeneralItem): CharacterGeneralItem => ({
  ...item,
  description: item.description || '',
  homebrewImageUrl: item.homebrewImageUrl || '',
  homebrewImageThumbUrl: item.homebrewImageThumbUrl || '',
  quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
  status: item.status || (item.equipped ? 'equipped' : 'unequipped'),
  rarity: item.rarity || 'common',
  equipped: item.equipped ?? false,
  macros: item.macros || [],
  effects: item.effects || [],
  actions: item.actions || [],
  localVariables: normalizeCharacterLocalVariables(item.localVariables),
  scripts: item.scripts || [],
  hidden: item.hidden ?? false,
});

export const buildCharacterFormulaContext = (character: CharacterData | null | undefined): Record<string, number> => {
  if (!character) return {};

  const context: Record<string, number> = {};
  const mainAttrs = character.mainAttributes || [];
  const secondaryAttrs = character.secondaryAttributes || [];
  const skills = character.skills || [];
  const otherAttrs = character.otherAttributes || [];
  const resistances = character.resistances || [];
  const bars = character.bars || [];
  const charStatuses = character.statuses || [];
  const charGeneralItems = character.generalItems || [];
  const charInventory = character.inventory || [];
  const charSpells = character.spells || [];
  const modFormula = character.modifierFormula || 'Math.floor((@value - 10) / 2)';

  const baseAttrs = [...mainAttrs, ...secondaryAttrs, ...otherAttrs, ...resistances];
  const skillAttrs = skills;
  const allAttrs = [...baseAttrs, ...skillAttrs];
  const mainAttrIds = mainAttrs.map(a => a.id).filter(Boolean);
  const baseAttrIds = baseAttrs.map(a => a.id).filter(Boolean);
  const skillIds = skillAttrs.map(a => a.id).filter(Boolean);
  const attrIds = allAttrs.map(a => a.id).filter(Boolean);
  const modIds = mainAttrIds.map(id => `${id}_mod`);

  const getAttributeCalculationType = (attributeId: string): AttributeCalculationType => (
    allAttrs.find((attr) => attr.id === attributeId)?.calculationType || DEFAULT_ATTRIBUTE_CALCULATION_TYPE
  );

  const applyAttributeEffectValue = (
    targetId: string,
    baseValue: number,
    contributions: number[],
  ) => {
    const calculationType = getAttributeCalculationType(targetId);
    if (calculationType === 'override-highest') {
      return baseValue + (contributions.length > 0 ? Math.max(...contributions) : 0);
    }
    if (calculationType === 'override-lowest') {
      return baseValue + (contributions.length > 0 ? Math.min(...contributions) : 0);
    }
    return baseValue + contributions.reduce((sum, contribution) => sum + contribution, 0);
  };

  const applyStatusEffects = (
    targetIds: string[],
    baseValues: Record<string, number>,
    sourceContext: Record<string, number>,
  ) => {
    const nextValues = { ...baseValues };
    const effectBuckets: Record<string, number[]> = {};

    charStatuses.forEach(status => {
      if ((status.active ?? true) === false) return;
      const statusLocalContext = buildLocalVariableContext(status.localVariables, sourceContext);
      (status.effects || []).forEach(effect => {
        if (effect.effectType && effect.effectType !== 'attribute') return;
        if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
          const effVal = evalCharacterFormula(effect.value || '0', sourceContext, statusLocalContext);
          if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
          effectBuckets[effect.targetId].push(effVal);
        }
      });

      (status.actions || []).forEach(action => {
        (action.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharacterFormula(effect.value || '0', sourceContext, statusLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });
      });
    });

    Object.entries(effectBuckets).forEach(([targetId, values]) => {
      nextValues[targetId] = applyAttributeEffectValue(targetId, nextValues[targetId] || 0, values);
    });

    return nextValues;
  };

  const applyInventoryEffects = (
    targetIds: string[],
    baseValues: Record<string, number>,
    sourceContext: Record<string, number>,
  ) => {
    const nextValues = { ...baseValues };
    const effectBuckets: Record<string, number[]> = {};

    charInventory.forEach(item => {
      if (!item.equipped) return;
      const itemLocalContext = buildLocalVariableContext(item.localVariables, sourceContext);

      (item.effects || []).forEach(effect => {
        if (effect.effectType && effect.effectType !== 'attribute') return;
        if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
          const effVal = evalCharacterFormula(effect.value || '0', sourceContext, itemLocalContext);
          if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
          effectBuckets[effect.targetId].push(effVal);
        }
      });

      (item.actions || []).forEach(action => {
        (action.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharacterFormula(effect.value || '0', sourceContext, itemLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });
      });
    });

    charGeneralItems.map(normalizeGeneralItemForContext).forEach(item => {
      if (!item.equipped) return;
      const itemLocalContext = buildLocalVariableContext(item.localVariables, sourceContext);

      (item.effects || []).forEach(effect => {
        if (effect.effectType && effect.effectType !== 'attribute') return;
        if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
          const effVal = evalCharacterFormula(effect.value || '0', sourceContext, itemLocalContext);
          if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
          effectBuckets[effect.targetId].push(effVal);
        }
      });

      (item.actions || []).forEach(action => {
        (action.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharacterFormula(effect.value || '0', sourceContext, itemLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });
      });
    });

    charSpells.forEach(spell => {
      const spellLocalContext = buildLocalVariableContext(spell.localVariables, sourceContext);
      (spell.actions || []).forEach(action => {
        (action.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharacterFormula(effect.value || '0', sourceContext, spellLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });
      });
    });

    Object.entries(effectBuckets).forEach(([targetId, values]) => {
      nextValues[targetId] = applyAttributeEffectValue(targetId, nextValues[targetId] || 0, values);
    });

    return nextValues;
  };

  attrIds.forEach((id) => {
    context[id] = 0;
  });
  modIds.forEach((id) => {
    context[id] = 0;
  });
  bars.forEach((bar) => {
    if (bar.id) {
      context[`${bar.id}_current`] = 0;
      if (getCharacterBarMode(bar) === 'resource') {
        context[`${bar.id}_reset`] = 0;
      } else {
        context[`${bar.id}_max`] = 0;
      }
    }
  });

  for (let pass = 0; pass < 12; pass += 1) {
    const previousContext = { ...context };
    const nextContext: Record<string, number> = {};

    baseAttrs.forEach(attr => {
      if (attr.id) {
        nextContext[attr.id] = evalCharacterFormula(attr.value || '0', previousContext);
      }
    });

    const attributesWithStatuses = applyStatusEffects(
      baseAttrIds,
      nextContext,
      { ...previousContext, ...nextContext },
    );

    const attributesWithItemEffects = applyInventoryEffects(
      baseAttrIds,
      attributesWithStatuses,
      { ...previousContext, ...attributesWithStatuses },
    );

    mainAttrIds.forEach(attrId => {
      const attrValue = attributesWithItemEffects[attrId] || 0;
      const formula = modFormula.replace(/@value/g, attrValue.toString());
      attributesWithItemEffects[`${attrId}_mod`] = evalCharacterFormula(formula, {
        ...previousContext,
        ...attributesWithItemEffects,
      });
    });

    const withModStatuses = applyStatusEffects(
      modIds,
      attributesWithItemEffects,
      { ...previousContext, ...attributesWithItemEffects },
    );

    const withModItemEffects = applyInventoryEffects(
      modIds,
      withModStatuses,
      { ...previousContext, ...withModStatuses },
    );

    skillAttrs.forEach((skill) => {
      if (!skill.id) return;
      const legacyBaseValue = evalCharacterFormula(skill.value || '0', {
        ...previousContext,
        ...withModItemEffects,
      });
      const linkedModifierValue = skill.linkedMainAttributeId
        ? withModItemEffects[`${skill.linkedMainAttributeId}_mod`] ?? 0
        : 0;
      const baseValue = legacyBaseValue + linkedModifierValue;
      const proficiencyValue = withModItemEffects.proficiency ?? 0;
      const mode = skill.proficiencyMode || 'none';
      const proficiencyBonus = mode === 'half'
        ? Math.floor(proficiencyValue / 2)
        : mode === 'proficient'
          ? proficiencyValue
          : mode === 'expertise'
            ? proficiencyValue * 2
            : 0;
      withModItemEffects[skill.id] = applyAttributeEffectValue(
        skill.id,
        baseValue,
        proficiencyBonus !== 0 ? [proficiencyBonus] : [],
      );
    });

    const skillValuesWithStatuses = applyStatusEffects(
      skillIds,
      withModItemEffects,
      { ...previousContext, ...withModItemEffects },
    );

    const allValuesWithEffects = applyInventoryEffects(
      skillIds,
      skillValuesWithStatuses,
      { ...previousContext, ...skillValuesWithStatuses },
    );

    bars.forEach(bar => {
      if (bar.id) {
        const barMode = getCharacterBarMode(bar);
        const baseCurrentId = `${bar.id}_current`;
        allValuesWithEffects[baseCurrentId] = evalCharacterFormula(bar.currentValue || '0', {
          ...previousContext,
          ...allValuesWithEffects,
        });
        if (barMode === 'resource') {
          allValuesWithEffects[`${bar.id}_reset`] = evalCharacterFormula(bar.resetValue || '0', {
            ...previousContext,
            ...allValuesWithEffects,
          });
        } else {
          allValuesWithEffects[`${bar.id}_max`] = evalCharacterFormula(bar.maxValue || '0', {
            ...previousContext,
            ...allValuesWithEffects,
          });
        }
      }
    });

    const resourceBarCurrentIds = bars
      .filter(bar => bar.id && getCharacterBarMode(bar) === 'resource')
      .map(bar => `${bar.id}_current`);
    if (resourceBarCurrentIds.length > 0) {
      const resourceValuesWithStatuses = applyStatusEffects(
        resourceBarCurrentIds,
        allValuesWithEffects,
        { ...previousContext, ...allValuesWithEffects },
      );
      Object.assign(allValuesWithEffects, applyInventoryEffects(
        resourceBarCurrentIds,
        resourceValuesWithStatuses,
        { ...previousContext, ...resourceValuesWithStatuses },
      ));
    }

    const nextKeys = new Set([...Object.keys(context), ...Object.keys(allValuesWithEffects)]);
    let hasChanged = false;

    nextKeys.forEach((key) => {
      const prevValue = previousContext[key] ?? 0;
      const nextValue = allValuesWithEffects[key] ?? 0;
      context[key] = nextValue;
      if (Math.abs(nextValue - prevValue) > 0.0001) {
        hasChanged = true;
      }
    });

    if (!hasChanged) break;
  }

  return context;
};
