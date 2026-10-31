// Fast lookup of known HUD panels: walks fixed routes from the HUD root instead of searching
// the whole tree. Returns null when the panel isn't there.
//
// From Predi-i/Deadlock-UI-Mods (Apache-2.0, see NOTICE). Changed: ported to a TypeScript
// module exporting find(), instead of a script that sets $.ModHudLookup.
// Scope paths verified against the October 1 HUD capture and native layouts.

import { isValid } from "./panel.ts";

let hud : Panel | null = null;
let core : Panel | null = null;
const cache = new Map<string, Panel>();

const routes : Record<string, string[]> = {
    GameTime: ["TopBar"],
    ChatInput: ["Chat", "ChatControls"],
    ChatTargetLabel: ["Chat", "ChatControls"],
    damageImpactInfo: ["damage_impact"],
    respawn_timer: ["gameplay_hud_dead"],
    gun_data: ["gameplay_hud", "gameplay_hud_alive", "crosshair", "gun"],
    BuffModifiers: ["gameplay_hud", "gameplay_hud_alive", "status_bars", "hud_modifiers"],
    slot_signature_3: ["AbilitiesContainer", "hud_signature"],
    hud_minimap: ["gameplay_hud", ".clamp_width", "minimap_persp", "minimap_container", "HudMinimapContainer"],
    minimap_container: ["gameplay_hud", ".clamp_width", "minimap_persp"],
};

const hudRoutes : Record<string, string[]> = {
    EscapeMenu: [],
    EscapeBackground: ["EscapeMenu"],
    Menu: ["EscapeMenu", "LeftStripe"],
    SubOptions: ["EscapeMenu", "LeftStripe", "Menu"],
    CitadelPartyContainer: [],
};

function child(panel : Panel | null, id : string) : Panel | null {
    return isValid(panel) ? (panel.Children() || []).find((node) => isValid(node) && node.id === id) || null : null;
}

function cached(id : string) : Panel | null {
    const panel = cache.get(id);
    return isValid(panel) ? panel : null;
}

export function find(id : string) : Panel | null {
    if(!isValid(hud)) {
        let panel : Panel | null = $.GetContextPanel();
        hud = null;
        for(let i = 0; isValid(panel) && i < 50; i++) {
            if(panel.id === "Hud") {
                hud = panel;
                break;
            }
            panel = panel.GetParent();
        }
        // base_hud scripts belong to the WindowRoot, which owns Hud directly.
        if(!hud) {
            hud = child($.GetContextPanel(), "Hud");
        }
        core = null;
        cache.clear();
    }
    if(id === "Hud") {
        return hud;
    }

    if(Object.prototype.hasOwnProperty.call(hudRoutes, id)) {
        const hit = cached(id);
        if(hit) {
            return hit;
        }
        let panel = hud;
        for(const step of hudRoutes[id]) {
            panel = child(panel, step);
        }
        const found = child(panel, id);
        if(found) {
            cache.set(id, found);
        }
        return found;
    }

    if(!isValid(core)) {
        core = isValid(hud) ? hud.Children().find((panel) => panel.BHasClass("HudCore")) || null : null;
        cache.clear();
    }
    if(!isValid(core)) {
        return null;
    }
    const hit = cached(id);
    if(hit) {
        return hit;
    }
    const direct = child(core, id);
    if(direct) {
        cache.set(id, direct);
        return direct;
    }

    const route = routes[id];
    if(!route) {
        return null;
    }
    let scope : Panel | null = core;
    for(const step of route) {
        const parent : Panel = scope;
        scope = step.charAt(0) === "."
            ? parent.Children().find((panel) => isValid(panel) && panel.BHasClass(step.substring(1))) || null
            : child(parent, step);
        if(!scope) {
            return null;
        }
    }
    // Anonymous wrappers in these small native subtrees have no stable ID.
    // Never fall back to traversing Hud/HudCore if a scope is missing.
    const found = child(scope, id) || scope.FindChildTraverse(id);
    if(isValid(found)) {
        cache.set(id, found);
        return found;
    }
    return null;
}
