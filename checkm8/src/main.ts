// Checkm8: sends a chat line when you get a kill (not an assist), picked from your hero's
// list in kill_lines.ts. Bundled into panorama/scripts/checkm8.js by `deno task bundle`.

import * as chat from "@shared/chat.ts";
import type { ChatChannel } from "@shared/chat.ts";
import { HERO_NAMES, heroName } from "@shared/heroes.ts";
import { find } from "@shared/hud_lookup.ts";
import { hasClass, isValid } from "@shared/panel.ts";
import * as umm from "@shared/umm.ts";
import { KILL_LINES } from "./kill_lines.ts";

// ------------------------------------------------------------------ config

// Defaults. UMM can override the first three at runtime (see `settings` below).
const CONFIG = {
    ENABLED: true,

    // Nothing is sent if chat opens on a different channel.
    CHANNEL: "all" as ChatChannel,

    // Kills within this window after a sent message are ignored, so a multikill
    // sends one message, not three.
    COOLDOWN_SECONDS: 3,

    // $.Schedule runs at most once per frame, so 0.01 means "every frame".
    POLL_SECONDS: 0.01,
    // Used while #damageImpactInfo doesn't exist (menus, loading screens).
    IDLE_POLL_SECONDS: 1.0,

    // TEMPORARY while hero detection is being fixed. false: log "would send: ..." instead of
    // sending, so kills can be tested without spamming chat.
    SEND_CHAT: true,

    // true: log to the console with a [Tangerie] prefix. `deno task dev` builds turn
    // this on; leave it false here so release builds stay quiet.
    DEBUG: false,

    // Replaced by the build with the commit's short hash ("-dirty" if uncommitted changes).
    VERSION: "dev",
};

// Marks a kill panel as already handled. Stored on the panel itself because panels get
// recycled for the next damage popup (see scanKills).
const HANDLED = "__checkm8Handled";

// ------------------------------------------------------------------ state

const CTX = $.GetContextPanel();

// Heroes that have lines, in kill_lines.ts order. Only these get a checkbox in UMM.
const HEROES_WITH_LINES = Object.keys(KILL_LINES).filter((hero) => KILL_LINES[hero].length > 0);

// UMM setting id for a hero's checkbox. Prefixed so a hero key can't clash with another setting.
function heroSettingId(hero : string) : string {
    return "hero_" + hero;
}

// Live settings: start as CONFIG, then UMM may change any of them at any time.
const settings = {
    enabled: CONFIG.ENABLED,
    channel: CONFIG.CHANNEL,
    cooldownSeconds: CONFIG.COOLDOWN_SECONDS,
    // Per hero, keyed by KILL_LINES key. Every hero with lines starts enabled.
    heroEnabled: {} as Record<string, boolean>,
};
for(const hero of HEROES_WITH_LINES) {
    settings.heroEnabled[hero] = true;
}

const state = {
    damageInfo: null as Panel | null,

    // false until the first scan finishes. Kills already on screen when the
    // script (re)loads are marked handled but not sent.
    primed: false,

    cooldownUntil: 0,
};

// ------------------------------------------------------------------ helpers

function log(message : string) : void {
    if(!CONFIG.DEBUG) {
        return;
    }
    $.Msg("[Tangerie] " + message);
}

function nowSeconds() : number {
    return Date.now() / 1000;
}

function lookup(id : string) : Panel | null {
    try {
        const found = find(id);
        return isValid(found) ? found : null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ one copy only

// If the HUD reloads, or two copies of this mod are installed, two poll loops could
// run at once and send twice. Each copy claims a generation number in a store shared
// across scripts; a loop stops when it sees a newer generation.
// GameUI.CustomUIConfig() isn't available everywhere, hence the fallback.
function getSharedStore() : Record<string, unknown> {
    try {
        if(typeof GameUI !== "undefined" && GameUI && GameUI.CustomUIConfig) {
            return GameUI.CustomUIConfig();
        }
    } catch {}
    const global = globalThis as { __checkmate? : Record<string, unknown> };
    global.__checkmate = global.__checkmate || {};
    return global.__checkmate;
}

const store = getSharedStore();
const generation = (Number(store.checkmate) || 0) + 1;
store.checkmate = generation;

function isRetired() : boolean {
    return !isValid(CTX) || store.checkmate !== generation;
}

const hooks = { log, alive: () => !isRetired() };

// ------------------------------------------------------------------ hero

// The player APIs (Game / Players) return false in this context, and the hero portraits
// (CitadelHeroImage) expose nothing to JS, not even the image path the debugger shows.
// What works: the shop panel carries `hero_<internal name>` for the local player's hero,
// and swaps it when you change hero. Other panels carry these classes too (the hero
// testing bot cards, the roster tooltip) but they follow whatever hero was last shown
// there, so only the shop is checked. Ability labels also differ per hero, but they're
// localised, so they'd only work on an English client.

// Every CitadelHudHeroShop one level under the Hud (Hud > unnamed panel > shop), found
// fresh on each kill. Never cached, here or via hud_lookup: after a hero change a cached
// shop panel stayed valid but still said the old hero (Solomon -> Paige still sent
// "Checkmate"). Kills are rare and this only looks at the Hud's direct children.
function findHeroShops() : Panel[] {
    const shops : Panel[] = [];
    const hud = lookup("Hud");
    if(!hud) {
        return shops;
    }
    for(let i = 0; i < hud.GetChildCount(); i++) {
        const child = hud.GetChild(i);
        const shop = isValid(child) ? child.FindChild("CitadelHudHeroShop") : null;
        if(isValid(shop)) {
            shops.push(shop);
        }
    }
    return shops;
}

function heroOf(shop : Panel) : string | null {
    for(const hero in KILL_LINES) {
        if(hasClass(shop, "hero_" + hero)) {
            return hero;
        }
    }
    return null;
}

// The KILL_LINES key of the hero you're playing, or null if the shop can't be found, the
// hero isn't listed (a hero added after the list was made), or shop panels disagree.
function detectHero() : string | null {
    const shops = findHeroShops();
    if(shops.length === 0) {
        log("hero: shop panel not found");
        return null;
    }
    const heroes = shops.map(heroOf);
    if(heroes.some((hero) => hero !== heroes[0])) {
        // Should only be one shop. If an old one is still around, we can't tell which
        // is current, so send nothing rather than the wrong hero's line.
        log("hero: " + shops.length + " shop panels disagree (" + heroes.join(", ") + ")");
        return null;
    }
    log("hero: " + (heroes[0] || "not in kill_lines.ts") + (shops.length > 1 ? " (" + shops.length + " shop panels)" : ""));
    return heroes[0];
}

// TEMPORARY probe. The shop's hero_* class doesn't always follow a hero change (Paige ->
// another hero still said hero_bookworm). DEBUG builds poll every hero source below and log
// "[Tangerie] probe: <source> = <value>" whenever one changes, so switching heroes in the
// sandbox shows which source keeps up. The ability bar is the reference: it's always current.
const PROBE_SECONDS = 1.0;

// Your own portrait in the top bar: the CitadelHudTopBarPlayer the game gives a LocalPlayer
// class. Its labels show your name, hero name and kills (citadel_hud_top_bar_player.xml).
function findLocalTopBar() : Panel | null {
    const hud = lookup("Hud");
    if(!hud) {
        return null;
    }
    for(const panel of hud.FindChildrenWithClassTraverse("LocalPlayer")) {
        if(isValid(panel) && isValid(panel.FindChildTraverse("PlayerNameNWContainer"))) {
            return panel;
        }
    }
    return null;
}

function labelText(parent : Panel, className : string) : string {
    const label = parent.FindChildrenWithClassTraverse(className)[0];
    return isValid(label) ? (label as Label).text : "?";
}

// Some languages prefix a grammatical gender ("#|f|#Paige"); drop it before comparing.
function normalizeName(name : string) : string {
    return name.replace(/^#\|[a-z]+\|#/i, "").trim().toLowerCase();
}

// Matches a hero name label against "#hero_<key>" localised in the client's own language,
// so it works on any language, not just English.
function heroFromName(name : string) : string | null {
    const wanted = normalizeName(name);
    for(const hero in HERO_NAMES) {
        if(normalizeName($.Localize("#hero_" + hero)) === wanted) {
            return hero;
        }
    }
    return null;
}

function probeSources() : Record<string, string> {
    const shops = findHeroShops();
    const sources : Record<string, string> = {};

    const topBar = findLocalTopBar();
    if(topBar) {
        const name = labelText(topBar, "HeroName");
        sources["top bar hero"] = name + " -> " + (heroFromName(name) || "no match");
        sources["top bar player"] = labelText(topBar, "PlayerName");
        sources["top bar kills"] = labelText(topBar, "kills");
    } else {
        sources["top bar hero"] = "no LocalPlayer panel";
    }

    sources["shop classes"] = shops
        .map((shop) => Object.keys(HERO_NAMES).filter((hero) => hasClass(shop, "hero_" + hero)).join("+") || "none")
        .join(" | ") || "no shop";

    // The shop's "{s:hero_name}'s Recommended Mods" header. Display name, so English only.
    sources["shop hero_name"] = shops.map((shop) => {
        const name = $.Localize("{s:hero_name}", shop);
        return name && name.indexOf("{") === -1 ? name : "unset";
    }).join(" | ") || "no shop";

    const third = lookup("slot_signature_3");
    const abilities = third ? third.GetParent() : null;
    const names : string[] = [];
    for(let slot = 1; slot <= 4 && isValid(abilities); slot++) {
        const panel = abilities.FindChild("slot_signature_" + slot);
        const label = isValid(panel) ? panel.FindChildrenWithClassTraverse("ability_name")[0] : null;
        names.push(isValid(label) ? (label as Label).text : "?");
    }
    sources["ability bar"] = names.join(", ") || "not found";

    const hud = lookup("Hud");
    sources["hero_* under Hud"] = !hud ? "no Hud" : Object.keys(HERO_NAMES)
        .map((hero) => [hero, hud.FindChildrenWithClassTraverse("hero_" + hero).length] as const)
        .filter(([, count]) => count > 0)
        .map(([hero, count]) => hero + " x" + count)
        .join(", ") || "none";

    return sources;
}

const probed : Record<string, string> = {};

function probeHero(all : boolean) : void {
    let sources : Record<string, string>;
    try {
        sources = probeSources();
    } catch(e) {
        log("probe: failed " + e);
        return;
    }
    for(const source in sources) {
        if(all || probed[source] !== sources[source]) {
            log("probe: " + source + " = " + sources[source]);
        }
        probed[source] = sources[source];
    }
}

function watchHero() : void {
    if(isRetired()) {
        return;
    }
    probeHero(false);
    $.Schedule(PROBE_SECONDS, watchHero);
}

// ------------------------------------------------------------------ kills

function onKill() : void {
    if(CONFIG.DEBUG) {
        probeHero(true);
    }

    if(!settings.enabled) {
        log("kill, but disabled in settings");
        return;
    }

    // Unknown hero sends nothing, same as a hero with no lines.
    const hero = detectHero();
    const lines = hero ? KILL_LINES[hero] : [];
    if(!hero || lines.length === 0) {
        log("kill, but no lines for " + (hero || "this hero"));
        return;
    }
    if(!settings.heroEnabled[hero]) {
        log("kill, but " + hero + " is disabled in settings");
        return;
    }

    const now = nowSeconds();
    if(now < state.cooldownUntil) {
        log("kill during cooldown, not sending");
        return;
    }
    if(chat.isSending()) {
        log("kill while a message is still sending, not sending");
        return;
    }

    // Cooldown starts at the kill, not when the message lands, so kills in the
    // same moment can't queue up behind the first one.
    state.cooldownUntil = now + settings.cooldownSeconds;
    const line = lines[Math.floor(Math.random() * lines.length)];
    if(!CONFIG.SEND_CHAT) {
        // Logged even without DEBUG, so release builds show it in the console too.
        $.Msg("[Tangerie] would send (" + hero + ", " + settings.channel + "): " + line);
        return;
    }
    log("kill");
    chat.send(line, settings.channel, hooks);
}

function findDamageInfo() : Panel | null {
    if(!isValid(state.damageInfo)) {
        state.damageInfo = lookup("damageImpactInfo");
    }
    return state.damageInfo;
}

function scanKills() : void {
    if(isRetired()) {
        log("newer copy running or HUD unloaded, stopping");
        return;
    }

    const info = findDamageInfo();
    if(!info) {
        $.Schedule(CONFIG.IDLE_POLL_SECONDS, scanKills);
        return;
    }

    // Usually zero children unless you're actively hitting a hero, so this is cheap.
    const count = info.GetChildCount();
    for(let i = 0; i < count; i++) {
        const popup = info.GetChild(i);
        if(!isValid(popup)) {
            continue;
        }

        const isKill = hasClass(popup, "killed") && !hasClass(popup, "assist");
        if(!isKill) {
            // The game reuses these panels for later popups. A reused panel starts
            // without `killed`, so clearing the mark here lets it fire again.
            popup[HANDLED] = false;
            continue;
        }
        if(popup[HANDLED]) {
            continue;
        }

        popup[HANDLED] = true;
        if(state.primed) {
            onKill();
        }
    }

    state.primed = true;
    $.Schedule(CONFIG.POLL_SECONDS, scanKills);
}

// ------------------------------------------------------------------ UMM settings

umm.register({
    id: "checkm8",
    name: "Checkm8",
    ...hooks,
    settings: [
        // "group" is a section header. No id, no value.
        { type: "group", label: "Checkm8" },
        {
            id: "enabled", type: "toggle", label: "Enabled",
            description: "Send a chat message when you get a kill (not an assist), if your hero has kill lines.",
            default: CONFIG.ENABLED,
        },
        {
            id: "channel", type: "select", label: "Channel",
            description: "Where to send it. Nothing is sent if chat opens on another channel.",
            default: CONFIG.CHANNEL,
            options: [
                { value: "all", label: "All chat" },
                { value: "team", label: "Team chat" },
            ],
        },
        {
            id: "cooldown", type: "slider", label: "Cooldown",
            description: "Kills this soon after a message don't send another.",
            min: 1, max: 15, step: 1, unit: "s",
            default: CONFIG.COOLDOWN_SECONDS,
        },
        // One checkbox per hero with lines. UMM sends each back keyed by the option's id.
        ...(HEROES_WITH_LINES.length === 0 ? [] : [{
            id: "heroes", type: "checks", label: "Heroes",
            description: "Which heroes send their kill lines.",
            options: HEROES_WITH_LINES.map((hero) => ({
                id: heroSettingId(hero), label: heroName(hero), default: true,
            })),
        }]),
    ],
    values: () => {
        const values : Record<string, unknown> = {
            enabled: settings.enabled,
            channel: settings.channel,
            cooldown: settings.cooldownSeconds,
        };
        for(const hero of HEROES_WITH_LINES) {
            values[heroSettingId(hero)] = settings.heroEnabled[hero];
        }
        return values;
    },
    onSet(key, value) {
        const hero = HEROES_WITH_LINES.find((hero) => heroSettingId(hero) === key);
        if(hero) {
            settings.heroEnabled[hero] = umm.toBool(value);
        } else if(key === "enabled") {
            settings.enabled = umm.toBool(value);
        } else if(key === "channel") {
            if(value === "all" || value === "team") {
                settings.channel = value;
            }
        } else if(key === "cooldown") {
            const seconds = Number(value);
            if(isFinite(seconds) && seconds >= 0) {
                settings.cooldownSeconds = seconds;
            }
        }
    },
});

// ------------------------------------------------------------------ start

log("loaded " + CONFIG.VERSION + " (generation " + generation + ")");
scanKills();
if(CONFIG.DEBUG) {
    watchHero();
}
