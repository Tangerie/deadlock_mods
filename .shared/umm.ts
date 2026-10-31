// Client for Universal Mod Manager (UMM), the settings window some players add to the
// Escape menu.
//
//   import * as umm from "@shared/umm.ts";
//   umm.register({ id, name, settings, values: () => ({...}), onSet(key, value) {}, log, alive });
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

import type { Hooks } from "./hooks.ts";

export interface UmmMod extends Hooks {
    id : string;
    name : string;
    /** UMM manifest entries: group, toggle, slider, select, checks, export, import. */
    settings : Record<string, unknown>[];
    /** Current values, keyed by setting id. UMM prefers what it already has saved. */
    values() : Record<string, unknown>;
    /** One call per setting: on register (saved value or default) and on every change. */
    onSet(key : string, value : unknown) : void;
}

const PROTOCOL = 1;

const mods : UmmMod[] = [];
let listening = false;

function isAlive(mod : UmmMod) : boolean {
    return !mod.alive || mod.alive();
}

function announce(mod : UmmMod) : void {
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

function onMessage(payload : unknown) : void {
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

/** Announce a mod to UMM. Its manifest is sent now and again whenever UMM says hello. */
export function register(mod : UmmMod) : void {
    if(!listening) {
        $.RegisterForUnhandledEvent("ClientUI_FireOutput", onMessage);
        listening = true;
    }
    mods.push(mod);
    announce(mod);
}

/** Values restored from UMM's storage can arrive as strings ("1", "0", "5"). */
export function toBool(value : unknown) : boolean {
    return value === true || value === 1 || value === "1" || value === "true";
}
