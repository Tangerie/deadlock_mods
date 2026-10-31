// What a mod passes to the shared modules so they fit in with it.
export interface Hooks {
    /** The mod's own logger, so shared code logs under the mod's prefix and DEBUG switch. */
    log? : (message : string) => void;
    /** Return false once the mod has been replaced or unloaded; shared code then stops. */
    alive? : () => boolean;
}
