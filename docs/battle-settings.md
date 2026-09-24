# Battle Settings, version 1

The same editor is used for inventory items, general items, spells and statuses,
both in Character Sheet and Asset Creator. Settings travel with action JSON.
Import/duplicate remaps attached-effect references to the newly generated IDs.
These settings are opt-in; existing actions keep their previous behavior.

## Targeting

- Aim at Self, Character, Map position or Selected characters; filter Everyone, Allies or Enemies.
- Selected characters use a single-cell pattern with independently checked range,
  LOS, faction and visibility. Choose 1 through Maximum targets (a deterministic
  caster-attribute formula, integer 1-100). Duplicate/ineligible IDs reject the action.
- Patterns: single cell, circle, square, line, cone, or a custom 9x9 editor.
  Circle uses Euclidean radius; square uses tile radius. Lines/cones originate at
  the acting character and point toward the aim location. They exclude the origin.
- Range is a deterministic formula in actor sheet values, measured in tiles using
  the encounter's existing Chebyshev distance. It does not roll dice or ask inputs.
- Include actor controls self-inclusion in an area; explicit Self always includes
  the actor. Neutral characters are neither allies nor enemies of other characters.
- Optional LOS checks both the aim point and each affected target. Circles, squares
  and custom patterns spread from the aim point; lines/cones from the actor.
- Preview and confirmation show eligible targets; execution recalculates them from
  current state. Hidden targets are excluded in Player preview. Walls/void are not
  eligible floor cells. This is not an authenticated multiplayer visibility system.

## Resolution

Automatic applies the landed branch. Attack, Saving throw and Opposed roll compare
two configurable formulas. Actor result greater than target result lands the
effect; equal results follow the explicit Tie winner setting. Save defaults to
target winning ties; Attack defaults to actor winning ties.

Actor formula rolls once per action or once per target. Target formula resolves
independently for each target. All checks capture pre-action stats, before outcomes
change any target. Advantage: `2d20kh1`; disadvantage: `2d20kl1`.

Formula scopes:

- Unqualified `@wis_mod` in Target roll/defense refers to that target.
- Unqualified values elsewhere refer to the acting character.
- `@actor.cha_mod` / `@target.wis_mod` explicitly select a character.
- `@@local_id` refers to the source item's/spell's/status's local variable. Referenced
  input variables use the existing action confirmation UI.
- Shared amount resolves once per action, using actor values, not target values.
  `@roll.amount` exposes it in checks and outcome steps.
- Outcomes can also use `@roll.actor`, `@roll.target`, and `@roll.margin`.
- `@action.target.quantity` is the number of eligible selected targets, after
  area/faction/visibility/LOS filtering. It is available before checks.
- `@action.target.affected` counts landed checks; `@action.target.resisted` counts
  resisted checks. They are final totals across all targets, not a running counter.
  Automatic actions count all targets as affected. These two totals are available
  to outcomes, costs and the shared amount, but cannot determine the checks whose
  results they count. A result-dependent shared amount is evaluated after checks;
  those checks cannot also reference that amount (a circular dependency).
- A once-per-action actor roll cannot depend on target values. Select per-target
  mode for target-dependent actor formulas.

Every landed/resisted branch is an ordered list of HP damage, HP restoration,
signed bar updates or attached action effects (status, bar update, item update).
Choose recipient: affected target or acting character. Actor-recipient steps default
to once **per affected target**, useful for life drain. Frequency can instead be
Once per action, executed once when that outcome branch has at least one target.
Once steps use caster context and final counters, not an arbitrary target's values
or per-target rolls/checks. They are not a one-off cost.
AP and source/action uses, in contrast, are consumed only once per action.
An empty resisted branch means no effect on a successful defense.

## Advanced action settings

- Availability formula: deterministic caster/source-local/input expression;
  zero aborts before checks or spending, displaying Unavailable reason. It can
  reference the chosen target count but not results that have not been rolled yet.
- Step condition: deterministic formula; zero skips the step. Results and target
  counters are available. Reorder/duplicate operations with the arrow/copy controls.
- Up to eight ordered follow-up checks, each comparing actor and target formulas
  per target. Run when selects previous landed, previous resisted or always.
  The final executed check determines landed/resisted and the final target counters.
  A skipped check preserves the preceding result. All checks run before outcomes.
- `@check.primary.landed`, `.resisted`, `.actor`, `.target`, `.executed` expose
  the initial check. Follow-up checks expose the same fields under their stable
  ID; Copy check reference copies its landed expression. Skipped checks expose
  zero for all five fields. Future check references are unavailable (not zero).
- After all checks: an independent ordered outcome list, executed after the final
  landed/resisted branch for each target. Use a Step condition referring to an
  intermediate check to attach its own effects, independent of the final result.
  Example: attack then save; put damage gated by `@check.primary.landed` here,
  then a status gated by the follow-up's `.landed`. Leave final branches empty.
- Push/pull: integer 0-100 tile distance, stopping at occupied tiles, walls, void,
  illegal height changes or diagonal corners. Direction is away from/toward the
  caster; actor-recipient steps use the target as the direction source. No MAP or
  reactions are consumed/triggered. Once-per-action push/pull is rejected because
  it would require an arbitrary target direction. No collision damage is inferred.
- Teleport: integer 0-100 maximum distance from the recipient; choose destination
  X/Y in confirmation. The tile must be empty floor, within range, visible in Player
  preview, and in LOS when required. No movement AP is charged beyond explicit costs.
  Invalid destinations roll back the whole action, including earlier targets.
- Action animation: automatic (spell=cast, others=attack), Attack or Cast. This is
  presentation only and never delays or repeats committed resource changes.

### Multiple costs and imported statuses

Add any number of cost rows (up to 24): Combat AP, Movement AP, Reaction AP or a
custom bar. Sheet and encounter editors offer the character's actual bars in a
dropdown; portable assets accept bar IDs. Each non-negative formula resolves once
per action and can use final target counters. Rows referencing the same bar are
summed before checking affordability. Any insufficient resource aborts everything.
Old single-cost settings remain compatible.

For example, charge `1` Combat AP and `@action.target.affected` Movement AP.
One successful hit among three selected targets spends 1 CAP and 1 MAP.

Choose Attached effect in an outcome and press **Import Status** to import an
existing status export from clipboard or JSON. This adds the template to the
action's attached effects and selects it for that outcome in one operation. On
Character Sheet, the existing import target/placeholder resolution is reused.
Encounter/portable imports retain template bindings; configure portable targets
before using them against characters with different attribute IDs.

### Save with half damage

Aim: map position; circle radius 2; range 8; check: Saving throw.
Difficulty: `12 + @cha_mod`; target: `2d20kh1 + @wis_mod`; target wins ties.
Shared amount: `8d6`. Landed: damage `@roll.amount`, then an attached status.
Resisted: damage `rounddown(@roll.amount / 2)`; no status step.

### Opposed charisma and wisdom

Actor: `1d20 + @cha_mod`; target: `1d20 + @wis_mod`; target wins ties.
Landed: attached status. Resisted: empty. The target must roll strictly lower for
the status to land. Change Tie winner to Actor for an inclusive comparison.

## Safety and limits

The entire command applies to a clone. Invalid formulas, missing bars/effects,
insufficient uses/AP or invalid item choices reject all changes, including earlier
targets. Undo restores the whole command. Damage types/resistance are not inferred:
use explicit target formulas when desired. Automatic critical-hit rules, prompted
reactions and legendary resistance remain future work.

Demo Game only changes its local encounter snapshots, not original character
sheets. Configuring Battle Settings does not replace normal sheet roll buttons.

Maps store only authored cells after expansion; negative coordinates are supported.
Each expand operation allows up to 100 extra cells per edge and at most 10,000 new
filled cells, to protect browser storage/rendering. Repeat expansions as needed;
there is no permanent initial-size cap. Coordinates are bounded to +/-1,000,000,
and actual browser memory/storage capacity still applies.
