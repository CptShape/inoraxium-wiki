export default Description;
/**
 * Represents a Roll / Roll group description.
 */
declare class Description {
    static types: {
        MULTILINE: string;
        INLINE: string;
    };
    /**
     * Create a `Description` instance.
     *
     * @param {string} text
     * @param {string} [type=inline]
     */
    constructor(text: string, type?: string | undefined);
    /**
     * Set the description text.
     *
     * @param {string|number} text
     */
    set text(arg: string);
    /**
     * The description text.
     *
     * @return {string}
     */
    get text(): string;
    /**
     * Set the description type.
     *
     * @param {string} type
     */
    set type(arg: string);
    /**
     * The description type.
     *
     * @return {string} "inline" or "multiline"
     */
    get type(): string;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @return {{text: string, type: string}}
     */
    toJSON(): {
        text: string;
        type: string;
    };
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @see {@link Description#text}
     *
     * @returns {string}
     */
    toString(): string;
    [textSymbol]: string | undefined;
    [typeSymbol]: string | undefined;
}
declare const textSymbol: unique symbol;
declare const typeSymbol: unique symbol;
