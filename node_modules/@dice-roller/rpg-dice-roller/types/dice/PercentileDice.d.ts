export default PercentileDice;
/**
 * Represents a percentile die.
 *
 * @extends StandardDice
 */
declare class PercentileDice extends StandardDice {
    /**
     * Create a `PercentileDice` instance.
     *
     * @param {number} [qty=1] The number of dice to roll (e.g. `4`)
     * @param {Map<string, Modifier>|Modifier[]|{}|null} [modifiers] The modifiers that affect the die
     * @param {boolean} [sidesAsNumber=false] Whether to show the sides as `%` (default) or `100`
     * @param {Description|string|null} [description=null] The roll description.
     *
     * @throws {TypeError} qty must be a positive integer, and modifiers must be valid
     */
    constructor(qty?: number | undefined, modifiers?: {} | Map<string, Modifier> | Modifier[] | null | undefined, sidesAsNumber?: boolean | undefined, description?: Description | string | null);
    sidesAsNumber: boolean;
    /**
     * The number of sides the die has
     *
     * @returns {number|string} `%` if `sidesAsNumber == false`, or `100` otherwise
     */
    get sides(): string | number;
}
import StandardDice from "./StandardDice.js";
