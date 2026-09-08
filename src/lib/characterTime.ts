import {
  CharacterAction,
  CharacterBar,
  CharacterData,
  CharacterLocalVariable,
  CharacterReplenishTrigger,
  CharacterScript,
  CharacterScriptBarUpdateEntry,
  CharacterScriptCondition,
  CharacterScriptStatusEntry,
  CharacterScriptTrigger,
  CharacterSpell,
  CharacterStatus,
  CharacterStatusDurationType,
  StatusEffect,
} from '../types/character';
import {
  buildCharacterFormulaContext,
  buildLocalVariableContext,
  evalCharacterFormula,
  getCharacterBarMode,
  normalizeCharacterLocalVariables,
} from './characterContext';

export type CharacterTimeAction = 'short-rest' | 'long-rest' | 'skip-minute' | 'end-battle' | 'end-turn';

export interface CharacterTimeProgressionOptions {
  minutes?: number;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const parseAmount = (value?: string): number => {
  const parsed = Number.parseFloat(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmount = (amount: number): string => (
  Number.isInteger(amount) ? `${amount}` : `${Math.round(amount * 100) / 100}`
);

const replenishValue = (currentValue: string | undefined, maxValue: string | undefined, amountValue: string | undefined): string => {
  const current = parseAmount(currentValue);
  const max = parseAmount(maxValue);
  const amount = parseAmount(amountValue);
  if (amount <= 0) return currentValue || '';

  const next = max > 0 ? Math.min(current + amount, max) : current + amount;
  return formatAmount(next);
};

const getStatusDurationType = (status: Partial<CharacterStatus>): CharacterStatusDurationType => (
  status.durationType || 'custom'
);

const getStatusDurationEndBehavior = (status: Partial<CharacterStatus>) => (
  status.durationEndBehavior || 'delete'
);

const applyStatusTimePassage = (
  statuses: CharacterStatus[] | undefined,
  changes: Partial<Record<CharacterStatusDurationType, number | 'deactivate'>>,
): CharacterStatus[] => (
  (statuses || [])
    .map((status) => {
      const durationType = getStatusDurationType(status);
      const change = changes[durationType];
      if (!change || durationType === 'custom') return status;

      if (change === 'deactivate') {
        return { ...status, active: false };
      }

      const nextAmount = parseAmount(status.duration) - change;
      if (nextAmount <= 0) {
        return getStatusDurationEndBehavior(status) === 'deactivate'
          ? { ...status, duration: '0', active: false }
          : null;
      }

      return {
        ...status,
        duration: formatAmount(nextAmount),
      };
    })
    .filter((status): status is CharacterStatus => Boolean(status))
);

const replenishActions = (actions: CharacterAction[] | undefined, triggers: CharacterReplenishTrigger[]): CharacterAction[] => (
  (actions || []).map(action => (
    action.replenishTrigger && triggers.includes(action.replenishTrigger)
      ? { ...action, usageRemaining: replenishValue(action.usageRemaining, action.maxUsage, action.replenishAmount) }
      : action
  ))
);

const replenishLocalVariables = (
  variables: CharacterLocalVariable[] | undefined,
  triggers: CharacterReplenishTrigger[],
): CharacterLocalVariable[] => (
  normalizeCharacterLocalVariables(variables).map((variable) => {
    if (variable.kind !== 'resource' || !variable.replenishTrigger || !triggers.includes(variable.replenishTrigger)) {
      return variable;
    }

    const amount = parseAmount(variable.replenishAmount);
    const current = parseAmount(variable.value);
    const nextValue = variable.replenishMode === 'set'
      ? amount
      : (() => {
        const gained = current + amount;
        const max = parseAmount(variable.maxValue);
        return max > 0 ? Math.min(gained, max) : gained;
      })();

    return {
      ...variable,
      value: formatAmount(nextValue),
    };
  })
);

const replenishSpellUsage = (spell: CharacterSpell, triggers: CharacterReplenishTrigger[]): CharacterSpell => (
  spell.replenishTrigger && triggers.includes(spell.replenishTrigger)
    ? { ...spell, usageRemaining: replenishValue(spell.usageRemaining, spell.totalUsage, spell.replenishAmount) }
    : spell
);

const applyReplenish = (character: CharacterData, triggers: CharacterReplenishTrigger[]): CharacterData => ({
  ...character,
  generalItems: (character.generalItems || []).map(item => ({
    ...item,
    actions: replenishActions(item.actions, triggers),
    localVariables: replenishLocalVariables(item.localVariables, triggers),
  })),
  inventory: (character.inventory || []).map(item => ({
    ...item,
    actions: replenishActions(item.actions, triggers),
    localVariables: replenishLocalVariables(item.localVariables, triggers),
  })),
  spells: (character.spells || []).map(spell => ({
    ...replenishSpellUsage(spell, triggers),
    actions: replenishActions(spell.actions, triggers),
    localVariables: replenishLocalVariables(spell.localVariables, triggers),
  })),
  statuses: (character.statuses || []).map(status => ({
    ...status,
    duration: status.replenishTrigger && triggers.includes(status.replenishTrigger)
      ? replenishValue(status.duration, status.maxDuration, status.replenishAmount)
      : status.duration,
    active: status.replenishTrigger && triggers.includes(status.replenishTrigger) && parseAmount(status.replenishAmount) > 0
      ? true
      : status.active,
    actions: replenishActions(status.actions, triggers),
    localVariables: replenishLocalVariables(status.localVariables, triggers),
  })),
});

const resetResourceBars = (character: CharacterData, trigger: NonNullable<CharacterBar['resetTrigger']>): CharacterData => {
  const context = buildCharacterFormulaContext(character);
  return {
    ...character,
    bars: (character.bars || []).map((bar) => {
      if (getCharacterBarMode(bar) !== 'resource' || bar.resetTrigger !== trigger) return bar;
      const resetValue = evalCharacterFormula(bar.resetValue || '0', context);
      return {
        ...bar,
        currentValue: `${Math.round(resetValue * 100) / 100}`,
      };
    }),
  };
};

const buildScriptAppliedStatus = (
  template: Partial<CharacterStatus>,
  conditionId: string,
  scriptStatusEntryId: string,
  folderId: string | null,
): CharacterStatus => ({
  id: `st_${uid()}`,
  name: template.name || 'Script Status',
  duration: template.duration || 'Script',
  durationType: template.durationType || 'custom',
  durationEndBehavior: template.durationEndBehavior || 'delete',
  maxDuration: template.maxDuration || '',
  replenishTrigger: template.replenishTrigger || 'custom',
  replenishAmount: template.replenishAmount || '',
  description: template.description || '',
  effects: (template.effects || []).map(effect => ({ ...effect })),
  actions: (template.actions || []).map(action => ({
    ...action,
    macros: (action.macros || []).map(macro => ({ ...macro })),
    effects: (action.effects || []).map(effect => ({ ...effect })),
  })),
  localVariables: (template.localVariables || []).map(variable => ({ ...variable })),
  scripts: (template.scripts || []).map(script => ({ ...script })),
  active: true,
  color: template.color || '#f59e0b',
  hidden: template.hidden ?? false,
  folderId,
  scriptSourceConditionId: conditionId,
  scriptSourceTemplateStatusId: scriptStatusEntryId,
});

const getScriptValue = (
  valueId: string,
  context: Record<string, number>,
  localContext: Record<string, number> = {},
): number => {
  if (valueId.startsWith('@@')) return localContext[valueId.slice(2)] ?? 0;
  return context[valueId] ?? 0;
};

const evaluateScriptCondition = (
  condition: CharacterScriptCondition,
  context: Record<string, number>,
  localContext: Record<string, number> = {},
): boolean => {
  const left = getScriptValue(condition.leftId, context, localContext);
  const value = evalCharacterFormula(condition.compareValue || '0', context, localContext);
  const min = evalCharacterFormula(condition.minValue || '0', context, localContext);
  const max = evalCharacterFormula(condition.maxValue || '0', context, localContext);

  switch (condition.operator) {
    case 'lt':
      return left < value;
    case 'lte':
      return left <= value;
    case 'gt':
      return left > value;
    case 'gte':
      return left >= value;
    case 'eq':
      return left === value;
    case 'neq':
      return left !== value;
    case 'between':
      return left >= Math.min(min, max) && left <= Math.max(min, max);
    case 'outside':
      return left < Math.min(min, max) || left > Math.max(min, max);
    default:
      return false;
  }
};

const getScriptRuntimeLocalVariables = (
  script: CharacterScript,
  character: CharacterData,
): CharacterLocalVariable[] | undefined => {
  if (!script.linkedScriptSourceType || !script.linkedScriptSourceId) return script.localVariables;
  if (script.linkedScriptSourceType === 'general-item') {
    return (character.generalItems || []).find(item => item.id === script.linkedScriptSourceId)?.localVariables || script.localVariables;
  }
  if (script.linkedScriptSourceType === 'inventory-item') {
    return (character.inventory || []).find(item => item.id === script.linkedScriptSourceId)?.localVariables || script.localVariables;
  }
  return (character.statuses || []).find(status => status.id === script.linkedScriptSourceId)?.localVariables || script.localVariables;
};

const applyScriptTrigger = (
  character: CharacterData,
  trigger: CharacterScriptTrigger,
): CharacterData => {
  const context = buildCharacterFormulaContext(character);
  const triggerNonce = Date.now() + Math.random();
  let nextStatuses = [...(character.statuses || [])];
  const pendingBarUpdates: Array<{ entry: CharacterScriptBarUpdateEntry; localContext: Record<string, number> }> = [];
  let scriptsChanged = false;

  const processScript = (script: CharacterScript): CharacterScript => {
    if ((script.active ?? true) === false) return script;
    const localVariables = getScriptRuntimeLocalVariables(script, character);
    const localContext = buildLocalVariableContext(localVariables, context);
    const scriptTriggerMatched = (script.triggerIds || []).includes(trigger);
    let changed = false;

    const updatedConditions = (script.conditions || []).map((condition) => {
      if (!condition.leftId) return condition;

      const isMatched = evaluateScriptCondition(condition, context, localContext);
      const legacyStatusEntries: CharacterScriptStatusEntry[] = (condition.statusIds || [])
        .map((statusId) => {
          const template = nextStatuses.find(status => status.id === statusId && !status.scriptSourceConditionId);
          if (!template) return null;
          return {
            id: statusId,
            name: template.name || statusId,
            entry: template,
            statusFolderId: template.folderId ?? null,
            onFalse: condition.onFalse || 'remove',
            appliedStatusInstanceIds: condition.appliedStatusInstanceIds || [],
          };
        })
        .filter((entry): entry is CharacterScriptStatusEntry => !!entry);
      const statusEntries = condition.statusEntries?.length ? condition.statusEntries : legacyStatusEntries;
      const normalizedEntries = statusEntries.map(entry => ({
        ...entry,
        appliedStatusInstanceIds: (entry.appliedStatusInstanceIds || []).filter(statusId => (
          nextStatuses.some(status => status.id === statusId)
        )),
      }));
      const normalizedBarUpdates = (condition.barUpdates || []).map(entry => ({
        ...entry,
        lastMatched: entry.lastMatched ?? false,
        lastTriggeredNonce: entry.lastTriggeredNonce,
      }));
      let entryChanged = JSON.stringify(normalizedEntries) !== JSON.stringify(condition.statusEntries || []);
      let barUpdatesChanged = JSON.stringify(normalizedBarUpdates) !== JSON.stringify(condition.barUpdates || []);

      if (isMatched) {
        const nextStatusEntries = normalizedEntries.map((entry) => {
          const alreadyApplied = nextStatuses.some(status => (
            status.scriptSourceConditionId === condition.id && status.scriptSourceTemplateStatusId === entry.id
          ));
          if (alreadyApplied) return entry;

          const createdStatus = buildScriptAppliedStatus(entry.entry, condition.id, entry.id, entry.statusFolderId ?? null);
          nextStatuses = [...nextStatuses, createdStatus];
          entryChanged = true;
          return {
            ...entry,
            appliedStatusInstanceIds: [...(entry.appliedStatusInstanceIds || []), createdStatus.id],
          };
        });

        const nextBarUpdates = normalizedBarUpdates.map((entry) => {
          const shouldApplyForValueMatch = !entry.lastMatched;
          const shouldApplyForTrigger = Boolean(
            scriptTriggerMatched && entry.lastTriggeredNonce !== triggerNonce
          );

          if ((shouldApplyForValueMatch || shouldApplyForTrigger) && entry.targetId) {
            pendingBarUpdates.push({ entry, localContext });
          }

          const nextEntry = {
            ...entry,
            lastMatched: true,
            lastTriggeredNonce: shouldApplyForTrigger ? triggerNonce : entry.lastTriggeredNonce,
          };
          if (JSON.stringify(nextEntry) !== JSON.stringify(entry)) {
            barUpdatesChanged = true;
          }
          return nextEntry;
        });

        if (entryChanged || barUpdatesChanged || condition.statusIds?.length || condition.appliedStatusInstanceIds?.length) {
          changed = true;
          return {
            ...condition,
            statusEntries: nextStatusEntries,
            barUpdates: nextBarUpdates,
            statusIds: [],
            appliedStatusInstanceIds: [],
          };
        }
        return condition;
      }

      const removeIds = new Set(
        normalizedEntries
          .filter(entry => entry.onFalse === 'remove')
          .flatMap(entry => entry.appliedStatusInstanceIds || [])
      );
      if (removeIds.size > 0) {
        nextStatuses = nextStatuses.filter(status => !removeIds.has(status.id));
      }

      const nextStatusEntries = normalizedEntries.map(entry => (
        entry.onFalse === 'remove'
          ? { ...entry, appliedStatusInstanceIds: [] }
          : entry
      ));
      const nextBarUpdates = normalizedBarUpdates.map(entry => (
        entry.lastMatched ? { ...entry, lastMatched: false } : entry
      ));

      if (
        removeIds.size > 0
        || entryChanged
        || JSON.stringify(nextBarUpdates) !== JSON.stringify(condition.barUpdates || [])
        || condition.statusIds?.length
        || condition.appliedStatusInstanceIds?.length
        || JSON.stringify(nextStatusEntries) !== JSON.stringify(condition.statusEntries || [])
      ) {
        changed = true;
        return {
          ...condition,
          statusEntries: nextStatusEntries,
          barUpdates: nextBarUpdates,
          statusIds: [],
          appliedStatusInstanceIds: [],
        };
      }

      return condition;
    });

    if (!changed) return script;
    scriptsChanged = true;
    return { ...script, conditions: updatedConditions };
  };

  const nextScripts = (character.scripts || []).map(processScript);
  let nextCharacter: CharacterData = {
    ...character,
    statuses: nextStatuses,
    scripts: scriptsChanged ? nextScripts : character.scripts,
  };

  if (pendingBarUpdates.length > 0) {
    nextCharacter = {
      ...nextCharacter,
      bars: (nextCharacter.bars || []).map((bar) => {
        const updates = pendingBarUpdates.filter(({ entry }) => entry.targetId === bar.id);
        if (updates.length === 0) return bar;

        const current = evalCharacterFormula(bar.currentValue || '0', context);
        const delta = updates.reduce((sum, { entry, localContext }) => (
          sum + evalCharacterFormula(entry.value || '0', context, localContext)
        ), 0);
        const max = getCharacterBarMode(bar) === 'resource' ? 0 : evalCharacterFormula(bar.maxValue || '0', context);
        const unclampedNext = current + delta;
        const nextCurrent = getCharacterBarMode(bar) === 'resource' || !Number.isFinite(max) || max <= 0
          ? unclampedNext
          : Math.min(unclampedNext, max);
        return {
          ...bar,
          currentValue: `${Math.round(nextCurrent * 100) / 100}`,
        };
      }),
    };
  }

  return nextCharacter;
};

export const applyCharacterTimeProgression = (
  character: CharacterData,
  action: CharacterTimeAction,
  options: CharacterTimeProgressionOptions = {},
): CharacterData => {
  let nextCharacter = character;
  let replenishTriggers: CharacterReplenishTrigger[] = [];
  let resetTrigger: NonNullable<CharacterBar['resetTrigger']> | null = null;
  let scriptTrigger: CharacterScriptTrigger | null = null;

  if (action === 'short-rest') {
    nextCharacter = {
      ...nextCharacter,
      statuses: applyStatusTimePassage(nextCharacter.statuses, {
        'short-rest': 1,
        minute: 60,
        round: 'deactivate',
      }),
    };
    replenishTriggers = ['short-rest'];
    resetTrigger = 'short-rest';
    scriptTrigger = 'short-rest';
  }

  if (action === 'long-rest') {
    nextCharacter = {
      ...nextCharacter,
      statuses: applyStatusTimePassage(nextCharacter.statuses, {
        'short-rest': 2,
        'long-rest': 1,
        minute: options.minutes ?? 480,
        round: 'deactivate',
      }),
    };
    replenishTriggers = ['short-rest', 'long-rest'];
    resetTrigger = 'long-rest';
    scriptTrigger = 'long-rest';
  }

  if (action === 'end-turn') {
    nextCharacter = {
      ...nextCharacter,
      statuses: applyStatusTimePassage(nextCharacter.statuses, {
        round: 1,
        minute: 0.2,
      }),
    };
    replenishTriggers = ['round'];
    resetTrigger = 'turn-end';
    scriptTrigger = 'round-end';
  }

  if (action === 'end-battle') {
    nextCharacter = {
      ...nextCharacter,
      statuses: applyStatusTimePassage(nextCharacter.statuses, {
        battle: 1,
      }),
    };
    replenishTriggers = ['battle'];
    resetTrigger = 'battle-end';
    scriptTrigger = 'battle-end';
  }

  if (action === 'skip-minute') {
    nextCharacter = {
      ...nextCharacter,
      statuses: applyStatusTimePassage(nextCharacter.statuses, {
        minute: options.minutes ?? 1,
        round: 'deactivate',
      }),
    };
  }

  if (replenishTriggers.length > 0) {
    nextCharacter = applyReplenish(nextCharacter, replenishTriggers);
  }
  if (resetTrigger) {
    nextCharacter = resetResourceBars(nextCharacter, resetTrigger);
  }
  if (scriptTrigger) {
    nextCharacter = applyScriptTrigger(nextCharacter, scriptTrigger);
  }

  return nextCharacter;
};
