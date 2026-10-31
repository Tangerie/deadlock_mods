// Checkm8: sends a chat line when you get a kill (not an assist), picked from your
// hero's list in kill_lines.js.
//
// Needs, included before this script (deno task pull orders them):
//   hud_lookup.js   $.ModHudLookup  fast HUD panel lookup
//   chat.js         $.ModChat       sends the line
//   umm.js          $.ModUmm        in-game settings (if UMM is installed)
//   kill_lines.js   $.ModKillLines  the lines per hero
(() => {
    "use strict";

    // ------------------------------------------------------------------ config

    // Defaults. UMM can override the first three at runtime (see `settings` below).
    const CONFIG = {
        ENABLED: true,

        // "all" or "team". Nothing is sent if chat opens on a different channel.
        /** @type {ChatChannel} */
        CHANNEL: "all",

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

    // Marks a kill panel as already handled. Stored as a property on the panel itself
    // because panels get recycled for the next damage popup (see scanKills).
    const HANDLED = "__checkm8Handled";

    // ------------------------------------------------------------------ state

    const CTX = $.GetContextPanel();

    // Live settings: start as CONFIG, then UMM may change any of them at any time.
    const settings = {
        enabled: CONFIG.ENABLED,
        channel: CONFIG.CHANNEL,
        cooldownSeconds: CONFIG.COOLDOWN_SECONDS,
    };

    /**
     * @type {{
     *     damageInfo: Panel | null,
     *     heroShop: Panel | null,
     *     primed: boolean,
     *     cooldownUntil: number,
     * }}
     */
    const state = {
        damageInfo: null,
        heroShop: null,

        // false until the first scan finishes. Kills already on screen when the
        // script (re)loads are marked handled but not sent.
        primed: false,

        cooldownUntil: 0,
    };

    // ------------------------------------------------------------------ helpers

    function log(message) {
        if(!CONFIG.DEBUG) {
            return;
        }
        $.Msg("[Tangerie] " + message);
    }

    // A panel reference can go stale when the game rebuilds part of the HUD.
    // Every native call on a dead panel throws, so check before using one.
    /**
     * @param {Panel | null | undefined} panel
     * @returns {panel is Panel}
     */
    function isValid(panel) {
        return !!(panel && panel.IsValid && panel.IsValid());
    }

    function hasClass(panel, className) {
        if(!isValid(panel)) {
            return false;
        }
        try {
            return panel.BHasClass(className);
        } catch {
            return false;
        }
    }

    function nowSeconds() {
        return Date.now() / 1000;
    }

    // hud_lookup.js walks known routes from the HUD root instead of searching the
    // whole tree, which is much cheaper. It returns null when the panel isn't there.
    function lookup(id) {
        try {
            const found = $.ModHudLookup ? $.ModHudLookup.find(id) : null;
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
    function getSharedStore() {
        try {
            if(typeof GameUI !== "undefined" && GameUI && GameUI.CustomUIConfig) {
                return GameUI.CustomUIConfig();
            }
        } catch {}
        globalThis.__checkmate = globalThis.__checkmate || {};
        return globalThis.__checkmate;
    }

    const store = getSharedStore();
    const generation = ((store.checkmate || 0) + 1);
    store.checkmate = generation;

    function isRetired() {
        return !isValid(CTX) || store.checkmate !== generation;
    }

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
    function findHeroShop() {
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

    // The kill_lines.js key of the hero you're playing, or null if the shop can't be found
    // or the hero isn't listed (a hero added after the list was made).
    function detectHero(killLines) {
        const shop = findHeroShop();
        if(!shop) {
            log("hero: shop panel not found");
            return null;
        }
        for(const hero in killLines) {
            if(hasClass(shop, "hero_" + hero)) {
                log("hero: " + hero);
                return hero;
            }
        }
        log("hero: not in kill_lines.js");
        return null;
    }

    // ------------------------------------------------------------------ kills

    /**
     * @param {Record<string, string[]>} killLines
     * @param {ModChat} chat
     */
    function onKill(killLines, chat) {
        if(!settings.enabled) {
            log("kill, but disabled in settings");
            return;
        }

        // Unknown hero sends nothing, same as a hero with no lines.
        const hero = detectHero(killLines);
        const lines = hero ? killLines[hero] : [];
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
        chat.send(lines[Math.floor(Math.random() * lines.length)], settings.channel, {
            log,
            alive: () => !isRetired(),
        });
    }

    function findDamageInfo() {
        if(!isValid(state.damageInfo)) {
            state.damageInfo = lookup("damageImpactInfo");
        }
        return state.damageInfo;
    }

    /**
     * @param {Record<string, string[]>} killLines
     * @param {ModChat} chat
     */
    function scanKills(killLines, chat) {
        if(isRetired()) {
            log("newer copy running or HUD unloaded, stopping");
            return;
        }
        const next = () => scanKills(killLines, chat);

        const info = findDamageInfo();
        if(!info) {
            $.Schedule(CONFIG.IDLE_POLL_SECONDS, next);
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
                onKill(killLines, chat);
            }
        }

        state.primed = true;
        $.Schedule(CONFIG.POLL_SECONDS, next);
    }

    // ------------------------------------------------------------------ UMM settings

    /** @param {ModUmm} umm */
    function registerSettings(umm) {
        umm.register({
            id: "checkm8",
            name: "Checkm8",
            log,
            alive: () => !isRetired(),
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
    }

    // ------------------------------------------------------------------ start

    // Each of these comes from another script in the same layout. If one is missing, the
    // includes are wrong (run `deno task pull`): say so instead of failing silently.
    const killLines = $.ModKillLines;
    const chat = $.ModChat;
    const umm = $.ModUmm;
    if(!killLines || !chat || !umm || !$.ModHudLookup) {
        $.Msg("[Tangerie] not started: kill_lines.js, chat.js, umm.js and hud_lookup.js must be included before checkm8.js");
        return;
    }

    log("loaded (generation " + generation + ")");
    registerSettings(umm);
    scanKills(killLines, chat);
})();
