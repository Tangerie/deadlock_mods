(() => {
    "use strict";

    // ------------------------------------------------------------------ config

    // What to say after a kill, per hero. One line is picked at random each kill. An empty
    // list means nothing is sent while playing that hero.
    // Keys are the game's internal hero names: the shop panel gets a `hero_<key>` class for
    // the hero you're playing (see detectHero). Display names from the English localisation.
    /** @type {Record<string, string[]>} */
    const KILL_LINES = {
        atlas: [],                   // Abrams
        fencer: [],                  // Apollo
        baba: [],                    // Baba
        bebop: [],                   // Bebop
        punkgoat: [],                // Billy
        nano: [],                    // Calico
        unicorn: [],                 // Celeste
        deadpack: [],                // Deadman Danny
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

    // Defaults. UMM can override the first three at runtime (see `settings` below).
    const CONFIG = {
        ENABLED: true,

        // "all" or "team". The mod refuses to send if chat opens on a different channel.
        CHANNEL: "all",

        // Kills within this window after a sent message are ignored, so a multikill
        // sends one message, not three.
        COOLDOWN_SECONDS: 3,

        // $.Schedule runs at most once per frame, so 0.01 means "every frame".
        POLL_SECONDS: 0.01,
        // Used while #damageImpactInfo doesn't exist (menus, loading screens).
        IDLE_POLL_SECONDS: 1.0,

        // Delays between attempts to submit after opening chat. First one is next frame.
        RETRY_DELAYS: [0, 0.016, 0.033, 0.05, 0.1, 0.2],
        // Frames the chat box must look ready before we submit.
        CONFIRM_FRAMES: 1,

        // true: log to the console / Panorama debugger with a [WellPlayed] prefix.
        DEBUG: true,
    };

    // Console commands that open each channel, tried in order until one works.
    // `say_chat_team` is confirmed by several mods; `say_chat` for all-chat is what
    // Well-Played-On-Kill ships with. The others are fallbacks.
    // targetClass is the class the chat panel gets for that channel.
    const CHANNELS = {
        all: { commands: ["say_chat", "say_chat_all"], targetClass: "ChatTarget_GameAll" },
        team: { commands: ["say_chat_team"], targetClass: "ChatTarget_GameAllies" },
    };
    const OTHER_TARGET_CLASSES = ["ChatTarget_GameAll", "ChatTarget_GameAllies", "ChatTarget_Team", "ChatTarget_Party"];

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

    function currentChannel() {
        return CHANNELS[settings.channel] || CHANNELS.all;
    }

    /**
     * @type {{
     *     damageInfo: Panel | null,
     *     chatInput: TextEntry | null,
     *     chatTargetLabel: Panel | null,
     *     heroShop: Panel | null,
     *     message: string,
     *     primed: boolean,
     *     sending: boolean,
     *     cooldownUntil: number,
     *     attempt: number,
     *     readyFrames: number,
     *     commandIndex: number,
     *     commandConfirmed: boolean,
     * }}
     */
    const state = {
        damageInfo: null,
        chatInput: null,
        chatTargetLabel: null,
        heroShop: null,

        // The kill line being sent right now.
        message: "",

        // false until the first scan finishes. Kills already on screen when the
        // script (re)loads are marked handled but not sent.
        primed: false,

        sending: false,
        cooldownUntil: 0,
        attempt: 0,
        readyFrames: 0,
        commandIndex: 0,
        commandConfirmed: false,
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

    // The KILL_LINES key of the hero you're playing, or null if the shop can't be found or
    // the hero isn't in KILL_LINES (a hero added after this list was made).
    function detectHero() {
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
        log("hero: not in KILL_LINES");
        return null;
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

    // ------------------------------------------------------------------ chat

    function findChatPanels() {
        if(isValid(state.chatInput) && isValid(state.chatTargetLabel)) {
            return true;
        }
        state.chatInput = /** @type {TextEntry | null} */ (lookup("ChatInput"));
        state.chatTargetLabel = lookup("ChatTargetLabel");
        return !!(state.chatInput && state.chatTargetLabel);
    }

    // The channel shows up as a class on one of the chat label's ancestors, e.g.
    // ChatTarget_GameAll. We check classes, not the label text, because the text is
    // translated and "(ALL)" won't match on a non-English client.
    function isTargetingChannel() {
        let cursor = state.chatTargetLabel;
        for(let depth = 0; isValid(cursor) && depth < 20; depth++) {
            if(hasClass(cursor, currentChannel().targetClass)) {
                return true;
            }
            for(const other of OTHER_TARGET_CLASSES) {
                if(other !== currentChannel().targetClass && hasClass(cursor, other)) {
                    return false;
                }
            }
            cursor = cursor.GetParent();
        }
        return false;
    }

    function openChat() {
        const command = currentChannel().commands[state.commandIndex];
        log("opening chat with `" + command + "`");
        try {
            $.DispatchEvent("CitadelConCommand", command);
        } catch {}
    }

    function closeChat(input) {
        try {
            $.DispatchEvent("CitadelChatInputBlur", input);
        } catch {}
        try {
            $.DispatchEvent("DropInputFocus", input);
        } catch {}
    }

    function submit() {
        const input = state.chatInput;
        if(!isValid(input)) {
            state.sending = false;
            return;
        }
        try {
            input.text = state.message;
            $.DispatchEvent("CitadelChatInputSubmitted", input);
            input.text = "";
        } catch(e) {
            log("submit failed: " + e);
            state.sending = false;
            return;
        }

        closeChat(input);
        // This command worked, so stop trying the fallbacks for the rest of the session.
        state.commandConfirmed = true;
        state.sending = false;
        log("sent \"" + state.message + "\"");
    }

    // Called repeatedly after openChat() until the chat box is ready or we give up.
    function trySubmit() {
        if(isRetired()) {
            return;
        }

        if(findChatPanels() && isTargetingChannel()) {
            if(state.readyFrames >= CONFIG.CONFIRM_FRAMES) {
                submit();
                return;
            }
            state.readyFrames++;
        } else {
            state.readyFrames = 0;
        }

        state.attempt++;
        if(state.attempt < CONFIG.RETRY_DELAYS.length) {
            $.Schedule(CONFIG.RETRY_DELAYS[state.attempt], trySubmit);
            return;
        }

        // This command never got us the right channel. Try the next one.
        if(!state.commandConfirmed && state.commandIndex < currentChannel().commands.length - 1) {
            state.commandIndex++;
            state.attempt = 0;
            state.readyFrames = 0;
            openChat();
            $.Schedule(CONFIG.RETRY_DELAYS[0], trySubmit);
            return;
        }

        log("gave up: chat never opened on the " + settings.channel + " channel");
        if(isValid(state.chatInput)) {
            closeChat(state.chatInput);
        }
        state.sending = false;
    }

    function sendMessage(message) {
        state.message = message;
        state.sending = true;
        state.attempt = 0;
        state.readyFrames = 0;
        openChat();
        $.Schedule(CONFIG.RETRY_DELAYS[0], trySubmit);
    }

    // ------------------------------------------------------------------ kills

    function onKill() {
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
        if(state.sending) {
            log("kill while a message is still sending, not sending");
            return;
        }

        // Cooldown starts at the kill, not when the message lands, so kills in the
        // same moment can't queue up behind the first one.
        state.cooldownUntil = now + settings.cooldownSeconds;
        log("kill");
        sendMessage(lines[Math.floor(Math.random() * lines.length)]);
    }

    function findDamageInfo() {
        if(!isValid(state.damageInfo)) {
            state.damageInfo = lookup("damageImpactInfo");
        }
        return state.damageInfo;
    }

    function scanKills() {
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

    // UMM and this script live in different JS contexts and share nothing, so they talk
    // over ClientUI_FireOutput, the one event that reaches every context, using JSON:
    //   UMM -> mods   {umm:1, t:"hello"}                       "announce yourselves"
    //   mod -> UMM    {umm:1, t:"register", id, name, settings, values}
    //   UMM -> mod    {umm:1, t:"set", id, key, value}          one per setting, on
    //                                                           register and on change
    // Either side can load first: we register on boot, UMM says hello on its boot.
    // If UMM isn't installed, nobody answers and the defaults stay.

    const UMM_PROTOCOL = 1;
    const UMM_ID = "checkm8";

    // ---- Examples: one of every UMM input type
    //
    // These do nothing except log their value, so you can see what each control looks
    // like and what UMM sends back. Copy the one you need into a real setting.
    //
    //   type      value sent in `set`          notes
    //   toggle    true / false                 may arrive as "1"/"0" after a restart
    //   slider    number                       min/max/step/unit; may arrive as a string
    //   select    the chosen option's `value`  `sort: true` orders options by label
    //   select    same                         `icons: "hero"` + `img` per option shows portraits
    //   checks    true / false PER OPTION      each option has its own id and its own `set`
    //   group     (nothing)                    section header
    //   export    (nothing)                    copy box for ALL of UMM's settings, not just ours
    //   import    (nothing)                    paste box that applies an exported string
    //
    // UMM has no free-text input.

    // const EXAMPLE_SETTINGS = [
    //     { type: "group", label: "Examples (every input type, these do nothing)" },
    //     {
    //         id: "example_toggle", type: "toggle", label: "Toggle",
    //         description: "On/off. Sends true or false.",
    //         default: false,
    //     },
    //     {
    //         id: "example_slider", type: "slider", label: "Slider",
    //         description: "A number between min and max in steps. `unit` is shown after the value.",
    //         min: 0, max: 10, step: 0.5, unit: "s",
    //         default: 2.5,
    //     },
    //     {
    //         id: "example_select", type: "select", label: "Select",
    //         description: "Pick one. Sends the option's value, not its label. Sorted A-Z by label.",
    //         sort: true,
    //         default: "medium",
    //         options: [
    //             { value: "small", label: "Small" },
    //             { value: "medium", label: "Medium" },
    //             { value: "large", label: "Large" },
    //         ],
    //     },
    //     {
    //         id: "example_hero", type: "select", label: "Select with hero icons",
    //         description: "icons: \"hero\" adds a portrait from images/heroes/<img>_sm_psd.",
    //         icons: "hero",
    //         default: "haze",
    //         options: [
    //             { value: "archer", label: "Grey Talon", img: "archer" },
    //             { value: "haze", label: "Haze", img: "haze" },
    //             { value: "warden", label: "Warden", img: "warden" },
    //             { value: "wraith", label: "Wraith", img: "wraith" },
    //         ],
    //     },
    //     {
    //         id: "example_checks", type: "checks", label: "Checks",
    //         description: "Several on/off boxes in one row. Each box is its own setting with its own id.",
    //         options: [
    //             { id: "example_check_kills", label: "Kills", default: true },
    //             { id: "example_check_assists", label: "Assists", default: false },
    //             { id: "example_check_objectives", label: "Objectives", default: false },
    //         ],
    //     },
    //     {
    //         id: "example_export", type: "export", label: "Export",
    //         description: "Copies ALL your UMM settings (every mod) as text. Same box as on UMM's General tab.",
    //     },
    //     {
    //         id: "example_import", type: "import", label: "Import",
    //         description: "Paste an exported string to apply it.",
    //     },
    // ];

    // // Current example values, keyed by the id UMM sends in `set`.
    // // Checks options are keyed by each option's id, not the row's id.
    // const examples = {
    //     example_toggle: false,
    //     example_slider: 2.5,
    //     example_select: "medium",
    //     example_hero: "haze",
    //     example_check_kills: true,
    //     example_check_assists: false,
    //     example_check_objectives: false,
    // };

    function ummManifest() {
        return {
            umm: UMM_PROTOCOL,
            t: "register",
            id: UMM_ID,
            name: "Checkm8",
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

                // ...EXAMPLE_SETTINGS,
            ],
            // Our current values. UMM prefers what it already has saved.
            values: {
                enabled: settings.enabled,
                channel: settings.channel,
                cooldown: settings.cooldownSeconds,
                // ...examples,
            },
        };
    }

    function ummRegister() {
        try {
            $.DispatchEvent("ClientUI_FireOutput", JSON.stringify(ummManifest()));
        } catch {}
    }

    // Values restored from UMM's storage can arrive as strings ("1", "0", "5"),
    // so coerce instead of trusting the type.
    function toBool(value) {
        return value === true || value === 1 || value === "1" || value === "true";
    }

    function applySetting(key, value) {
        if(key === "enabled") {
            settings.enabled = toBool(value);
        } else if(key === "channel") {
            const next = String(value);
            if(CHANNELS[next] && next !== settings.channel) {
                settings.channel = next;
                // The confirmed open command belonged to the old channel.
                state.commandIndex = 0;
                state.commandConfirmed = false;
            }
        } else if(key === "cooldown") {
            const seconds = Number(value);
            if(isFinite(seconds) && seconds >= 0) {
                settings.cooldownSeconds = seconds;
            }
        } 
        // else if(Object.prototype.hasOwnProperty.call(examples, key)) {
        //     // Coerce to the type the default has: UMM may send "1", "2.5" etc.
        //     const current = examples[key];
        //     if(typeof current === "boolean") {
        //         examples[key] = toBool(value);
        //     } else if(typeof current === "number") {
        //         const n = Number(value);
        //         if(isFinite(n)) {
        //             examples[key] = n;
        //         }
        //     } else {
        //         examples[key] = String(value);
        //     }
        // } 
        else {
            return;
        }
        log("setting " + key + " = " + JSON.stringify(value));
    }

    function onUmmMessage(payload) {
        if(isRetired() || typeof payload !== "string" || payload.indexOf("\"umm\"") === -1) {
            return;
        }

        let message;
        try {
            message = JSON.parse(payload);
        } catch {
            return;
        }
        if(!message || message.umm !== UMM_PROTOCOL) {
            return;
        }

        if(message.t === "hello") {
            ummRegister();
        } else if(message.t === "set" && message.id === UMM_ID) {
            applySetting(message.key, message.value);
        }
    }

    $.RegisterForUnhandledEvent("ClientUI_FireOutput", onUmmMessage);

    // ------------------------------------------------------------------ start

    log("loaded (generation " + generation + ")");
    ummRegister();
    scanKills();
})();
