// Checkm8: sends a chat line when you get a kill (not an assist), picked from your hero's
// list in kill_lines.ts. Bundled into panorama/scripts/checkm8.js by `deno task bundle`.

import * as chat from "@shared/chat.ts";
import type { ChatChannel } from "@shared/chat.ts";
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

    // true: log to the console with a [Tangerie] prefix. `deno task dev` builds turn
    // this on; leave it false here so release builds stay quiet.
    DEBUG: false,
};

// Marks a kill panel as already handled. Stored on the panel itself because panels get
// recycled for the next damage popup (see scanKills).
const HANDLED = "__checkm8Handled";

// ------------------------------------------------------------------ state

const CTX = $.GetContextPanel();

// Live settings: start as CONFIG, then UMM may change any of them at any time.
const settings = {
    enabled: CONFIG.ENABLED,
    channel: CONFIG.CHANNEL,
    cooldownSeconds: CONFIG.COOLDOWN_SECONDS,
};

const state = {
    damageInfo: null as Panel | null,
    heroShop: null as Panel | null,

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

// Hud > (unnamed panel) > CitadelHudHeroShop. hud_lookup finds it if the unnamed panel
// is HudCore; otherwise look one level down from the Hud ourselves.
function findHeroShop() : Panel | null {
    if(isValid(state.heroShop)) {
        return state.heroShop;
    }
    let shop = lookup("CitadelHudHeroShop");
    const hud = shop ? null : lookup("Hud");
    if(hud) {
        for(let i = 0; i < hud.GetChildCount() && !shop; i++) {
            const child = hud.GetChild(i);
            if(isValid(child)) {
                shop = child.FindChild("CitadelHudHeroShop");
            }
        }
    }
    state.heroShop = isValid(shop) ? shop : null;
    return state.heroShop;
}

// The KILL_LINES key of the hero you're playing, or null if the shop can't be found or
// the hero isn't listed (a hero added after the list was made).
function detectHero() : string | null {
    const shop = findHeroShop();
    if(!shop) {
        log("hero: shop panel not found");
        return null;
    }
    for(const hero in KILL_LINES) {
        if(hasClass(shop, "hero_" + hero)) {
            log("hero: " + hero);
            return hero;
        }
    }
    log("hero: not in kill_lines.ts");
    return null;
}

// ------------------------------------------------------------------ kills

function onKill() : void {
    if(!settings.enabled) {
        log("kill, but disabled in settings");
        return;
    }

    // Unknown hero sends nothing, same as a hero with no lines.
    const hero = detectHero();
    const lines = hero ? KILL_LINES[hero] : [];
    if(lines.length === 0) {
        log("kill, but no lines for " + (hero || "this hero"));
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
    log("kill");
    chat.send(lines[Math.floor(Math.random() * lines.length)], settings.channel, hooks);
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
    ],
    values: () => ({
        enabled: settings.enabled,
        channel: settings.channel,
        cooldown: settings.cooldownSeconds,
    }),
    onSet(key, value) {
        if(key === "enabled") {
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

log("loaded (generation " + generation + ")");
scanKills();
