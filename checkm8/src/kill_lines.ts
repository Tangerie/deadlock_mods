// Chat lines to send after a kill, per hero. main.ts picks one at random each kill.
// An empty list means nothing is sent while playing that hero.
//
// Keys are the game's internal hero names, not display names: the shop panel gets a
// `hero_<key>` class for the hero you're playing, which is how main.ts tells them apart.
// The display name (from the English localisation) is in the comment after each.
export const KILL_LINES : Record<string, string[]> = {
    atlas: [],                   // Abrams
    fencer: [],                  // Apollo
    baba: [],                    // Baba
    bebop: [],                   // Bebop
    punkgoat: [],                // Billy
    nano: [],                    // Calico
    unicorn: [],                 // Celeste
    deadpack: ["This kill was brought to you by Fairfax Industries"],                // Deadman Danny
    drifter: [],                 // Drifter
    dynamo: [],                  // Dynamo
    necro: [],                   // Graves
    orion: [],                   // Grey Talon
    haze: [],                    // Haze
    astro: [],                   // Holliday
    inferno: [],                 // Infernus
    tengu: [],                   // Ivy
    kelvin: [],                  // Kelvin
    ghost: [],                   // Lady Geist
    lash: [],                    // Lash
    forge: [],                   // McGinnis
    vampirebat: [],              // Mina
    mirage: [],                  // Mirage
    krill: [],                   // Mo & Krill
    nurse: [],                   // Nurse Harrow
    bookworm: [],                // Paige
    chrono: [],                  // Paradox
    synth: [],                   // Pocket
    ratking: [],                 // Rat King
    familiar: [],                // Rem
    gigawatt: [],                // Seven
    shiv: [],                    // Shiv
    werewolf: [],                // Silver
    magician: [],                // Sinclair
    chessmaster: ["Checkmate"],  // Solomon
    doorman: [],                 // The Doorman
    priest: [],                  // Venator
    frank: [],                   // Victor
    hornet: [],                  // Vindicta
    artist: [],                  // Violet
    viscous: [],                 // Viscous
    viper: [],                   // Vyper
    warden: [],                  // Warden
    wraith: [],                  // Wraith
    yamato: [],                  // Yamato
};
