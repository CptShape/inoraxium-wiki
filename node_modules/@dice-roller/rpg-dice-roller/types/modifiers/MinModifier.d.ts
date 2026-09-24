export default MinModifier;
/**
 * A `MinModifier` causes die rolls under a minimum value to be treated as the minimum value.
 *
 * @since 4.3.0
 *
 * @see {@link MaxModifier} for the opposite of this modifier
 *
 * @extends {Modifier}
 */
declare class MinModifier extends Modifier {
    /**
     * Create a `MinModifier` instance.
     *
     * @param {number} min The minimum value
     *
     * @throws {TypeError} min must be a number
     */
    constructor(min: number);
    /**
     * Set the minimum value.
     *
     * @param {number} value
     *
     * @throws {TypeError} min must be a number
     */
    set min(arg: number);
    /**
     * The minimum value.
     *
     * @returns {Number}
     */
    get min(): number;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{notation: string, name: string, type: string, min: Number}}
     */
    toJSON(): {
        notation: string;
        name: string;
        type: string;
        min: number;
    };
    [minSymbol]: number | undefined;
}
import Modifier from "./Modifier.js";
declare const minSymbol: unique symbol;
