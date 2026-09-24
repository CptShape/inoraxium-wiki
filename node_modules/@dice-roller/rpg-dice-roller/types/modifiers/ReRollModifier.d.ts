export default ReRollModifier;
/**
 * A `ReRollModifier` re-rolls dice that match a given test, and replaces the new value with the old
 * one.
 *
 * @see {@link ExplodeModifier} if you want to keep the old value as well
 *
 * @extends ComparisonModifier
 */
declare class ReRollModifier extends ComparisonModifier {
    /**
     * Create a `ReRollModifier` instance.
     *
     * @param {boolean} [once=false] Whether to only re-roll once or not
     * @param {ComparePoint} [comparePoint=null] The comparison object
     */
    constructor(once?: boolean | undefined, comparePoint?: any);
    /**
     * Set whether the modifier should only re-roll once or not.
     *
     * @param {boolean} value
     */
    set once(arg: boolean);
    /**
     * Whether the modifier should only re-roll once or not.
     *
     * @returns {boolean} `true` if it should re-roll once, `false` otherwise
     */
    get once(): boolean;
    /**
     * The default compare point definition
     *
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {array}
     */
    defaultComparePoint(_context: StandardDice | RollGroup): array;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{
     *  notation: string,
     *  name: string,
     *  type: string,
     *  comparePoint: (ComparePoint|undefined),
     *  once: boolean
     * }}
     */
    toJSON(): {
        notation: string;
        name: string;
        type: string;
        comparePoint: (ComparePoint | undefined);
        once: boolean;
    };
    [onceSymbol]: boolean | undefined;
}
import ComparisonModifier from "./ComparisonModifier.js";
declare const onceSymbol: unique symbol;
