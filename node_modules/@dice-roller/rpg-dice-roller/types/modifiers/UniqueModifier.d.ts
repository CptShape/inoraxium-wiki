export default UniqueModifier;
/**
 * A `UniqueModifier` re-rolls any non-unique dice values and, optionally that match a given test.
 *
 * @extends ComparisonModifier
 */
declare class UniqueModifier extends ComparisonModifier {
    /**
     * Create a `UniqueModifier` instance.
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
