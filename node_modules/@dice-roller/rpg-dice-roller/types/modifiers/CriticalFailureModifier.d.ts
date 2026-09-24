export default CriticalFailureModifier;
/**
 * A `CriticalFailureModifier` modifier flags values that match a comparison.
 *
 * Unlike most other modifiers, it doesn't affect the roll value, it simply "flags" matching rolls.
 *
 * @see {@link CriticalSuccessModifier} for the opposite of this modifier
 *
 * @extends ComparisonModifier
 */
declare class CriticalFailureModifier extends ComparisonModifier {
    /**
     * Create a `CriticalFailureModifier` instance.
     *
     * @param {ComparePoint} [comparePoint] The comparison object
     *
     * @throws {TypeError} comparePoint must be a `ComparePoint` object
     */
    constructor(comparePoint?: any);
    /**
     * The default compare point definition
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {array}
     */
    defaultComparePoint(_context: StandardDice | RollGroup): array;
}
import ComparisonModifier from "./ComparisonModifier.js";
