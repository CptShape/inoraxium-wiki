export default KeepModifier;
/**
 * A `KeepModifier` will "keep" dice from a roll, dropping (Remove from total calculations) all
 * others.
 *
 * @see {@link DropModifier} for the opposite of this modifier
 *
 * @extends Modifier
 */
declare class KeepModifier extends Modifier {
    /**
     * Create a `KeepModifier` instance
     *
     * @param {string} [end=h] Either `h|l` to keep highest or lowest
     * @param {number} [qty=1] The amount dice to keep
     *
     * @throws {RangeError} End must be one of 'h' or 'l'
     * @throws {TypeError} qty must be a positive integer
     */
    constructor(end?: string | undefined, qty?: number | undefined);
    /**
     * Set which end the rolls should be kept ("h" = High, "l" = Low).
     *
     * @param {string} value Either 'h' or 'l'
     *
     * @throws {RangeError} End must be one of 'h' or 'l'
     */
    set end(arg: string);
    /**
     * Which end the rolls should be kept ("h" = High, "l" = Low).
     *
     * @returns {string} 'h' or 'l'
     */
    get end(): string;
    /**
     * Set the quantity of dice that should be kept.
     *
     * @param {number} value
     *
     * @throws {TypeError} qty must be a positive finite integer
     */
    set qty(arg: number);
    /**
     * The quantity of dice that should be kept.
     *
     * @returns {number}
     */
    get qty(): number;
    /**
     * Determine the start and end (end exclusive) range of rolls to drop.
     *
     * @param {RollResults} _results The results to drop from
     *
     * @returns {number[]} The min / max range to drop
     */
    rangeToDrop(_results: RollResults): number[];
    /**
     * Run the modifier on the results.
     *
     * @param {ResultGroup|RollResults} results The results to run the modifier against
     * @param {StandardDice|RollGroup} _context The object that the modifier is attached to
     *
     * @returns {ResultGroup|RollResults} The modified results
     */
    run(results: ResultGroup | RollResults, _context: StandardDice | RollGroup): ResultGroup | RollResults;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{notation: string, name: string, type: string, qty: number, end: string}}
     */
    toJSON(): {
        notation: string;
        name: string;
        type: string;
        qty: number;
        end: string;
    };
    [endSymbol]: string | undefined;
    [qtySymbol]: number | undefined;
}
import Modifier from "./Modifier.js";
import RollResults from "../results/RollResults.js";
import ResultGroup from "../results/ResultGroup.js";
declare const endSymbol: unique symbol;
declare const qtySymbol: unique symbol;
