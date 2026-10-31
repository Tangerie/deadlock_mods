// Every hero's internal name mapped to its display name (from the English localisation).
// The game uses internal names in panel classes (`hero_<name>`, e.g. on the shop panel)
// and image paths (`images/heroes/<name>_sm_psd`), so code keys on these, not display names.

export const HERO_NAMES : Record<string, string> = {
    atlas: "Abrams",
    fencer: "Apollo",
    baba: "Baba",
    bebop: "Bebop",
    punkgoat: "Billy",
    nano: "Calico",
    unicorn: "Celeste",
    deadpack: "Deadman Danny",
    drifter: "Drifter",
    dynamo: "Dynamo",
    necro: "Graves",
    orion: "Grey Talon",
    haze: "Haze",
    astro: "Holliday",
    inferno: "Infernus",
    tengu: "Ivy",
    kelvin: "Kelvin",
    ghost: "Lady Geist",
    lash: "Lash",
    forge: "McGinnis",
    vampirebat: "Mina",
    mirage: "Mirage",
    krill: "Mo & Krill",
    nurse: "Nurse Harrow",
    bookworm: "Paige",
    chrono: "Paradox",
    synth: "Pocket",
    ratking: "Rat King",
    familiar: "Rem",
    gigawatt: "Seven",
    shiv: "Shiv",
    werewolf: "Silver",
    magician: "Sinclair",
    chessmaster: "Solomon",
    doorman: "The Doorman",
    priest: "Venator",
    frank: "Victor",
    hornet: "Vindicta",
    artist: "Violet",
    viscous: "Viscous",
    viper: "Vyper",
    warden: "Warden",
    wraith: "Wraith",
    yamato: "Yamato",
};

/** Display name for an internal hero name, or the internal name if it isn't listed. */
export function heroName(hero : string) : string {
    return HERO_NAMES[hero] || hero;
}

// Some languages prefix a grammatical gender ("#|f|#Paige"); drop it before comparing.
// Case is ignored too: the top bar shows names in capitals ("SOLOMON").
function normalizeName(name : string) : string {
    return name.replace(/^#\|[a-z]+\|#/i, "").trim().toLowerCase();
}

/**
 * Internal hero name for a display name shown in the HUD, or null if none match. Compares
 * against "#hero_<name>" localised in the client's own language, so it isn't English-only.
 */
export function heroFromName(name : string) : string | null {
    const wanted = normalizeName(name);
    if(!wanted) {
        return null;
    }
    for(const hero in HERO_NAMES) {
        if(normalizeName($.Localize("#hero_" + hero)) === wanted) {
            return hero;
        }
    }
    return null;
}
