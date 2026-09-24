export default HasDescription;
/**
 * A base class for description functionality.
 *
 * @abstract
 */
declare class HasDescription {
    constructor(text?: null);
    /**
     * Set the description on the group.
     *
     * @param {Description|string|null} description
     */
    set description(arg: Description | null);
    /**
     * The description for the group.
     *
     * @return {Description|null}
     */
    get description(): Description | null;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{description: (Description|null)}}
     */
    toJSON(): {
        description: (Description | null);
    };
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @see {@link RollGroup#notation}
     *
     * @returns {string}
     */
    toString(): string;
    [descriptionSymbol]: any;
}
import Description from "../Description.js";
declare const descriptionSymbol: unique symbol;
