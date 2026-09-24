export default FudgeDice;
/**
 * Represents a Fudge / Fate type die.
 *
 * @extends StandardDice
 */
declare class FudgeDice extends StandardDice {
    /**
     * Create a `FudgeDice` instance.
     *
     * @param {number} [nonBlanks=2] The number of sides each symbol should cover (`1` or `2`)
     * @param {number} [qty=1] The number of dice to roll (e.g. `4`)
     * @param {Map<string, Modifier>|Modifier[]|{}|null} [modifiers] The modifiers that affect the die
     * @param {Description|string|null} [description=null] The roll description.
     *
     * @throws {RangeError} nonBlanks must be 1 or 2
     * @throws {TypeError} modifiers must be valid
     */
    constructor(nonBlanks?: number | undefined, qty?: number | undefined, modifiers?: {} | Map<string, Modifier> | Modifier[] | null | undefined, description?: Description | string | null);
    /**
     * The number of sides that each symbol (+, -) covers.
     *
     * @returns {number} `1` or `2`
     */
    get nonBlanks(): number;
    /**
     * The number of sides the die has.
     *
     * @returns {string} 'F.2' or 'F.1'
     */
    get sides(): string;
}
import StandardDice from "./StandardDice.js";
