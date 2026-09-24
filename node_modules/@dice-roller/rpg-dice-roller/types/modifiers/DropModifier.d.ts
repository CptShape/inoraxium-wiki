export default DropModifier;
/**
 * A `DropModifier` will "drop" (Remove from total calculations) dice from a roll.
 *
 * @see {@link KeepModifier} for the opposite of this modifier
 *
 * @extends KeepModifier
 */
declare class DropModifier extends KeepModifier {
    /**
     * Determine the start and end (end exclusive) range of rolls to drop.
     *
     * @param {RollResults} _results The results to drop from
     *
     * @returns {number[]} The min / max range to drop
     */
    rangeToDrop(_results: RollResults): number[];
}
import KeepModifier from "./KeepModifier.js";
