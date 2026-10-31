// Helpers every script needs. Panels die when the game rebuilds part of the HUD, and every
// native call on a dead panel throws, so check before using one.

export function isValid(panel : Panel | null | undefined) : panel is Panel {
    return !!(panel && panel.IsValid && panel.IsValid());
}

export function hasClass(panel : Panel | null | undefined, className : string) : boolean {
    if(!isValid(panel)) {
        return false;
    }
    try {
        return panel.BHasClass(className);
    } catch {
        return false;
    }
}
