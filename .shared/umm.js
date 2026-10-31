// Client for Universal Mod Manager (UMM), the settings window some players add to the
// Escape menu. Canonical copy; `deno task sync` copies it into mods.
//
//   $.ModUmm.register({ id, name, settings, values: () => ({...}), onSet(key, value) {}, log, alive });
//
// UMM and the mods live in different JS contexts and share nothing, so they talk over
// ClientUI_FireOutput, the one event that reaches every context, using JSON:
//   UMM -> mods   {umm:1, t:"hello"}                       "announce yourselves"
//   mod -> UMM    {umm:1, t:"register", id, name, settings, values}
//   UMM -> mod    {umm:1, t:"set", id, key, value}          one per setting, on
//                                                           register and on change
// Either side can load first: mods register on boot, UMM says hello on its boot.
// If UMM isn't installed, nobody answers and the mod's defaults stay.
// The setting types UMM understands are listed in the README.
(() => {
    "use strict";

    const PROTOCOL = 1;

    /** @type {UmmMod[]} */
    const mods = [];

    function isAlive(mod) {
        return !mod.alive || mod.alive();
    }

    function announce(mod) {
        try {
            $.DispatchEvent("ClientUI_FireOutput", JSON.stringify({
                umm: PROTOCOL,
                t: "register",
                id: mod.id,
                name: mod.name,
                settings: mod.settings,
                values: mod.values(),
            }));
        } catch {}
    }

    function onMessage(payload) {
        if(typeof payload !== "string" || payload.indexOf("\"umm\"") === -1) {
            return;
        }

        let message;
        try {
            message = JSON.parse(payload);
        } catch {
            return;
        }
        if(!message || message.umm !== PROTOCOL) {
            return;
        }

        for(const mod of mods) {
            if(!isAlive(mod)) {
                continue;
            }
            if(message.t === "hello") {
                announce(mod);
            } else if(message.t === "set" && message.id === mod.id) {
                mod.onSet(message.key, message.value);
                if(mod.log) {
                    mod.log("setting " + message.key + " = " + JSON.stringify(message.value));
                }
            }
        }
    }

    function register(mod) {
        mods.push(mod);
        announce(mod);
    }

    // Values restored from UMM's storage can arrive as strings ("1", "0", "5"),
    // so coerce instead of trusting the type.
    function toBool(value) {
        return value === true || value === 1 || value === "1" || value === "true";
    }

    $.RegisterForUnhandledEvent("ClientUI_FireOutput", onMessage);

    $.ModUmm = {
        register,
        toBool,
    };
})();
