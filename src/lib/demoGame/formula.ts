import jsep from 'jsep';
import { DiceRoll } from '@dice-roller/rpg-dice-roller';
import type { CharacterData, CharacterLocalVariable } from '../../types/character';
import { buildCharacterFormulaContext } from '../characterContext';
import { validateBattleSettings } from '../battleSettings';
import { validateCharacterSprites } from '../characterSprites';

const functions: Record<string, (...values: number[]) => number> = {
  roundup: Math.ceil, rounddown: Math.floor, round: Math.round,
  ceil: Math.ceil, floor: Math.floor, min: Math.min, max: Math.max, abs: Math.abs,
};
const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const normalize = (source: string) => source.replace(/=</g, '<=').replace(/=>/g, '>=').replace(/(^|[^<>=!])=(?!=)/g, '$1==');

function interpret(node: jsep.Expression, vars: Record<string, number>, depth = 0): number {
  if (depth > 80) throw new Error('Formula nesting is too deep.');
  const next = (value: jsep.Expression) => interpret(value, vars, depth + 1);
  if (node.type === 'Literal') {
    const value = (node as jsep.Literal).value;
    if (typeof value === 'number' || typeof value === 'boolean') return Number(value);
  }
  if (node.type === 'Identifier') {
    const name = (node as jsep.Identifier).name;
    if (hasOwn(vars, name)) return vars[name];
    throw new Error(`Unknown variable: ${name}`);
  }
  if (node.type === 'UnaryExpression') {
    const n = node as jsep.UnaryExpression;
    if (n.operator === '-') return -next(n.argument);
    if (n.operator === '+') return next(n.argument);
    if (n.operator === '!') return Number(!next(n.argument));
  }
  if (node.type === 'BinaryExpression') {
    const n = node as jsep.BinaryExpression;
    const a = next(n.left);
    if (n.operator === '&&') return a ? Number(Boolean(next(n.right))) : 0;
    if (n.operator === '||') return a ? 1 : Number(Boolean(next(n.right)));
    const b = next(n.right);
    switch (n.operator) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case '%': return a % b;
      case '**': return a ** b;
      case '>': return Number(a > b);
      case '>=': return Number(a >= b);
      case '<': return Number(a < b);
      case '<=': return Number(a <= b);
      case '==': case '===': return Number(a === b);
      case '!=': case '!==': return Number(a !== b);
    }
  }
  if (node.type === 'ConditionalExpression') {
    const n = node as jsep.ConditionalExpression;
    return next(n.test) ? next(n.consequent) : next(n.alternate);
  }
  if (node.type === 'CallExpression') {
    const n = node as jsep.CallExpression;
    let name = n.callee.type === 'Identifier' ? (n.callee as jsep.Identifier).name.toLowerCase() : '';
    if (n.callee.type === 'MemberExpression') {
      const member = n.callee as jsep.MemberExpression;
      if (!member.computed && member.object.type === 'Identifier' && (member.object as jsep.Identifier).name === 'Math') {
        name = (member.property as jsep.Identifier).name;
      }
    }
    if (name === 'if' && (n.arguments.length === 1 || n.arguments.length === 3)) {
      return next(n.arguments[0]) ? (n.arguments[1] ? next(n.arguments[1]) : 1) : (n.arguments[2] ? next(n.arguments[2]) : 0);
    }
    if (hasOwn(functions, name) && n.arguments.length > 0 && n.arguments.length <= 32) return functions[name](...n.arguments.map(next));
  }
  throw new Error('Unsupported formula expression.');
}

export interface RollResolution { total: number; outcome?: 'Success' | 'Failure'; details: string[] }

export function resolveFormula(source: string, context: Record<string, number>, locals: Record<string, number> = {}, dice = false): RollResolution {
  if (source.length > 2000) throw new Error('Formula is too long.');
  const vars: Record<string, number> = {};
  const details: string[] = [];
  let count = 0;
  let expression = (source || '0').replace(/@@([a-zA-Z0-9_-]+)|@([a-zA-Z0-9_.-]+)/g, (_, local: string, global: string) => {
    const value = (local ? locals[local] : context[global]);
    if (!Number.isFinite(value)) throw new Error(`Unknown value: ${local ? '@@' + local : '@' + global}`);
    const key = `v${count++}`;
    vars[key] = value;
    details.push(`${local ? '@@' + local : '@' + global}: ${value}`);
    return key;
  });
  let diceCount = 0;
  expression = expression.replace(/\b(\d*)d(\d+)((?:kh|kl)\d*)?\b/gi, (notation, quantity, sides) => {
    if (!dice) throw new Error('Dice are only allowed in rolls.');
    diceCount += Number(quantity || 1);
    if (diceCount > 100 || Number(sides) > 100000 || Number(sides) < 1) throw new Error('Dice limit exceeded.');
    const roll = new DiceRoll(notation.replace(/^d/i, '1d'));
    details.push(roll.output);
    const key = `v${count++}`;
    vars[key] = roll.total;
    return key;
  });
  const tree = jsep(normalize(expression));
  if (tree.type === 'CallExpression' && (tree as jsep.CallExpression).callee.type === 'Identifier'
    && ((tree as jsep.CallExpression).callee as jsep.Identifier).name.toLowerCase() === 'dc') {
    const args = (tree as jsep.CallExpression).arguments;
    if (args.length !== 2) throw new Error('DC requires a difficulty and a roll.');
    const dc = interpret(args[0], vars);
    const total = interpret(args[1], vars);
    if (!Number.isFinite(total) || !Number.isFinite(dc)) throw new Error('Formula must return a finite number.');
    return { total, outcome: total >= dc ? 'Success' : 'Failure', details: [...details, `${total} / DC ${dc}`] };
  }
  const total = interpret(tree, vars);
  if (!Number.isFinite(total)) throw new Error('Formula must return a finite number.');
  return { total, details };
}

// Existing sheet calculations remain the source of stat stacking and bar semantics.
// Validate formula syntax before allowing a snapshot into that legacy evaluator.
export function validateSnapshot(character: CharacterData) {
  validateCharacterSprites(character.sprites);
  for (const entry of [...(character.inventory || []), ...(character.generalItems || []), ...(character.spells || []), ...(character.statuses || [])]) {
    for (const action of entry.actions || []) if (action.battleSettings) validateBattleSettings(action.battleSettings);
  }
  const expressions = [character.modifierFormula || 'rounddown((@value - 10) / 2)',
    ...[...(character.mainAttributes || []), ...(character.secondaryAttributes || []), ...(character.otherAttributes || []), ...(character.skills || []), ...(character.resistances || [])].map(a => a.value),
    ...(character.bars || []).flatMap(b => [b.currentValue, b.maxValue, b.resetValue || '0']),
    ...[...(character.inventory || []), ...(character.generalItems || []), ...(character.spells || []), ...(character.statuses || [])].flatMap(entry => [
      ...(entry.localVariables || []).filter(v => v.kind !== 'input').map(v => v.value),
      ...('effects' in entry ? entry.effects || [] : []).filter(e => !e.effectType || e.effectType === 'attribute').map(e => e.value),
      ...(entry.actions || []).flatMap(a => (a.effects || []).filter(e => !e.effectType || e.effectType === 'attribute').map(e => e.value)),
    ])];
  for (const formula of expressions) {
    const replaced = (formula || '0').replace(/@@?[a-zA-Z0-9_-]+/g, '1');
    // Walk all branches to reject executable syntax even in an inactive IF branch.
    const tree = jsep(normalize(replaced));
    const check = (node: jsep.Expression) => {
      if (!['Literal', 'UnaryExpression', 'BinaryExpression', 'ConditionalExpression', 'CallExpression', 'Identifier', 'MemberExpression'].includes(node.type)) throw new Error('Unsupported character formula.');
      if (node.type === 'CallExpression') {
        const call = node as jsep.CallExpression;
        const callee = call.callee;
        const member = callee as jsep.MemberExpression;
        const name = callee.type === 'Identifier' ? (callee as jsep.Identifier).name :
          callee.type === 'MemberExpression' && !member.computed && (member.object as jsep.Identifier).name === 'Math' ? (member.property as jsep.Identifier).name : '';
        if (!hasOwn(functions, name) && name !== 'if') throw new Error(`Unsupported function: ${name}`);
        call.arguments.forEach(check);
        return;
      }
      if (node.type === 'MemberExpression' || node.type === 'Identifier' || (node.type === 'Literal' && !['number', 'boolean'].includes(typeof (node as jsep.Literal).value))) throw new Error('Unsupported character formula value.');
      for (const value of Object.values(node)) if (value && typeof value === 'object' && 'type' in value) check(value as jsep.Expression);
    };
    check(tree);
  }
}

export function characterContext(character: CharacterData) { return buildCharacterFormulaContext(character); }

export function resolveLocals(variables: CharacterLocalVariable[], context: Record<string, number>, inputs: Record<string, number>) {
  const values: Record<string, number> = {};
  const visiting = new Set<string>();
  const resolve = (id: string): number => {
    if (hasOwn(values, id)) return values[id];
    if (visiting.has(id)) throw new Error(`Circular local variable: ${id}`);
    const variable = variables.find(v => v.id === id);
    if (!variable) throw new Error(`Unknown local variable: ${id}`);
    visiting.add(id);
    if (variable.kind === 'input') {
      if (!Number.isFinite(inputs[id])) throw new Error(`Input required: ${variable.description || id}`);
      values[id] = inputs[id];
    } else {
      for (const match of variable.value.matchAll(/@@([a-zA-Z0-9_-]+)/g)) resolve(match[1]);
      values[id] = resolveFormula(variable.value, context, values).total;
    }
    visiting.delete(id);
    return values[id];
  };
  return { values, resolve };
}
