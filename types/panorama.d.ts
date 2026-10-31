// Type hints for Deadlock Panorama scripts.
//
// Hand-written, not from Valve. Everything not marked @experimental is used by working
// community mods (Predi-i/Deadlock-UI-Mods, civo7/QOLLOCK, Hantu-Raya) as of Oct 2026.
// @experimental members work in some JS contexts and are undefined in others, or come
// from Valve's Dota 2 API and may not exist in Deadlock at all. Guard them with typeof.
//
// Panorama runs plain ES2021 in its own V8 with NONE of the browser globals:
// no window, document, fetch, setTimeout, setInterval, localStorage, atob/btoa.
// jsconfig.json leaves out the DOM lib so using any of those is an error in the editor.

// ============================================================================ panels

/**
 * Inline styles. Property names are camelCase versions of Panorama CSS
 * (`font-size` -> `fontSize`). Values are always strings, e.g. "42px", "50%", "#ff0000".
 * Panorama throws on values it can't parse, so wrap risky writes in try/catch.
 */
interface PanelStyle {
    width?: string | null;
    height?: string | null;
    x?: string | null;
    y?: string | null;
    position?: string | null;
    margin?: string | null;
    marginTop?: string | null;
    marginBottom?: string | null;
    marginLeft?: string | null;
    marginRight?: string | null;
    padding?: string | null;
    horizontalAlign?: "left" | "center" | "right" | string | null;
    verticalAlign?: "top" | "center" | "middle" | "bottom" | string | null;
    flowChildren?: "none" | "down" | "right" | "up" | "left" | string | null;
    visibility?: "visible" | "collapse" | string | null;
    opacity?: string | null;
    zIndex?: string | null;
    color?: string | null;
    backgroundColor?: string | null;
    washColor?: string | null;
    border?: string | null;
    borderRadius?: string | null;
    boxShadow?: string | null;
    /** Panorama form: "x y blur strength color", e.g. "0px 0px 6px 2.0 #000000". */
    textShadow?: string | null;
    fontSize?: string | null;
    fontWeight?: string | null;
    fontFamily?: string | null;
    textAlign?: string | null;
    textTransform?: string | null;
    letterSpacing?: string | null;
    transform?: string | null;
    preTransformScale2d?: string | null;
    /** e.g. "radial(50% 50%, 0deg, 270deg)". Cooldown rings expose their progress here. */
    clip?: string | null;
    transitionProperty?: string | null;
    transitionDuration?: string | null;
    transitionTimingFunction?: string | null;
    transitionDelay?: string | null;
    animationName?: string | null;
    animationDuration?: string | null;
    /** Any other Panorama CSS property in camelCase. */
    [property: string]: string | null | undefined;
}

/** Base type of every panel. */
interface Panel {
    /** The XML `id`. Duplicate ids are normal in repeated subtrees (one per player/item). */
    readonly id: string;
    readonly paneltype: string;
    style: PanelStyle;

    visible: boolean;
    enabled: boolean;
    /** false = mouse clicks pass through this panel. */
    hittest: boolean;
    hittestchildren: boolean;

    /** Label/TextEntry only. Undefined on other panel types. */
    text?: string;
    /** Label only: render `text` as limited HTML. */
    html?: boolean;

    /** Measured size/position in physical pixels. Divide by actualuiscale_* before writing to style. */
    readonly actuallayoutwidth: number;
    readonly actuallayoutheight: number;
    readonly actualxoffset: number;
    readonly actualyoffset: number;
    readonly actualuiscale_x: number;
    readonly actualuiscale_y: number;
    readonly contentwidth: number;
    readonly contentheight: number;
    readonly desiredlayoutwidth: number;
    readonly desiredlayoutheight: number;

    /** false once the game has destroyed this panel. Every other call on a dead panel throws. */
    IsValid(): boolean;

    GetParent(): Panel | null;
    /** Reparent this panel. Works on native panels too (how mods move native widgets). */
    SetParent(parent: Panel): void;
    GetChild(index: number): Panel | null;
    GetChildCount(): number;
    Children(): Panel[];
    /** Direct children only. */
    FindChild(id: string): Panel | null;
    /** Whole subtree, depth first. A miss walks everything: cache hits, back off on misses. */
    FindChildTraverse(id: string): Panel | null;
    FindChildInLayoutFile(id: string): Panel | null;
    FindChildrenWithClassTraverse(className: string): Panel[];
    MoveChildBefore(child: Panel, before: Panel): void;
    MoveChildAfter(child: Panel, after: Panel): void;

    AddClass(className: string): void;
    RemoveClass(className: string): void;
    SetHasClass(className: string, has: boolean): void;
    ToggleClass(className: string): void;
    SwitchClass(attribute: string, className: string): void;
    BHasClass(className: string): boolean;

    SetDialogVariable(name: string, value: string): void;
    SetDialogVariableInt(name: string, value: number): void;
    SetDialogVariableFloat(name: string, value: number): void;
    SetDialogVariableTime(name: string, value: number): void;

    SetAttributeString(name: string, value: string): void;
    GetAttributeString(name: string, fallback: string): string;
    SetAttributeInt(name: string, value: number): void;
    GetAttributeInt(name: string, fallback: number): number;
    SetAttributeUInt32(name: string, value: number): void;
    GetAttributeUInt32(name: string, fallback: number): number;

    SetFocus(): boolean;
    SetAcceptsFocus(accepts: boolean): void;
    BHasKeyFocus(): boolean;
    SetDraggable(draggable: boolean): void;

    /** e.g. BLoadLayout("file://{resources}/layout/my_layout.xml", false, false) */
    BLoadLayout(path: string, overrideExisting: boolean, partialLayout: boolean): boolean;
    BLoadLayoutFromString(xml: string, overrideExisting: boolean, partialLayout: boolean): boolean;
    /** Instantiate a <snippet name="..."> from this panel's layout file into this panel. */
    BLoadLayoutSnippet(name: string): boolean;

    /** Destroy after `delay` seconds. */
    DeleteAsync(delay: number): void;
    /** Inline handler, like onactivate="..." in XML. Note: does NOT deliver HTML* events. */
    SetPanelEvent(event: string, handler: () => void): void;
    ClearPanelEvent(event: string): void;
    /** Remove a style set from script, restoring the stylesheet value. Takes the CSS name: "wash-color". */
    ClearPropertyFromCode(cssProperty: string): void;
    ApplyStyles(force: boolean): void;
    ScrollToTop(): void;
    ScrollToBottom(): void;

    /**
     * Your own per-panel data. Must start with "__" so typos on real members still error.
     * Survives as long as the panel does; the game reuses some panels, so reset it yourself.
     */
    [expando: `__${string}`]: unknown;
}

interface Label extends Panel {
    text: string;
    html: boolean;
}

interface TextEntry extends Panel {
    text: string;
}

interface ImagePanel extends Panel {
    SetImage(path: string): void;
}

/**
 * Chromium browser panel. Full fetch/WebSocket inside the page, unlike Panorama itself.
 * Talk to it with SetURL("javascript:...") and read replies from the HTMLTitle event
 * (document.title, max 4096 chars). See README "Networking".
 */
interface CitadelHTMLPanel extends Panel {
    SetURL(url: string): void;
}

/**
 * @experimental Player name panels on scoreboards/profiles expose the Steam account id
 * (used by ShowRank). Not every name panel has it.
 */
interface PlayerNamePanel extends Panel {
    accountid?: number | string;
}

/** Panel types $.CreatePanel accepts in the HUD. Others (WebPanel, HTMLPanel, ...) throw. */
type CreatablePanelType = "Panel" | "Label" | "Image" | "TextEntry" | "Button" | "MoviePanel" | "CitadelHTMLPanel" | "HTML";

// ============================================================================ events

/** Events you send with $.DispatchEvent. Argument lists as observed in working mods. */
interface PanoramaDispatchEvents {
    /** Run a console command, e.g. "say_chat", "say_chat_team", "hud_free_cursor 1". Cheat-protected commands still need sv_cheats. */
    CitadelConCommand: [command: string];
    /** Same as pressing Enter in the chat box. Put the text in input.text first. */
    CitadelChatInputSubmitted: [chatInput: Panel];
    /** Close the chat box. */
    CitadelChatInputBlur: [chatInput: Panel];
    DropInputFocus: [panel: Panel];
    SetInputFocus: [panel: Panel];
    /** Click a button. */
    Activated: [panel: Panel, source?: "mouse" | "keyboard"];
    MouseActivate: [panel: Panel];
    CopyStringToClipboard: [text: string, panel?: Panel];
    /** Play a sound event by name (from a .vsndevts file). */
    PlaySoundEffect: [soundEvent: string];
    ExternalBrowserGoToURL: [url: string];
    SteamOverlayOpenURL: [url: string];
    UIShowTextTooltip: [panel: Panel, text: string];
    UIHideTextTooltip: [panel: Panel];
    DismissAllContextMenus: [];
    CitadelResumePlaying: [];
    CitadelShowProfilePageForAccount: [accountId: number];
    /** The only event that crosses JS contexts. Mods send JSON strings over it (UMM protocol). */
    ClientUI_FireOutput: [payload: string];
}

/** Events you listen for with $.RegisterForUnhandledEvent / $.RegisterEventHandler. */
interface PanoramaListenEvents {
    /** Match phase changed. Fires before the HUD has settled: panels may not exist yet. */
    CitadelGameStateChanged: [];
    CitadelOpenUpgradeShop: [];
    CitadelExitUpgradeShop: [];
    CitadelToggleUpgradeShop: [];
    CitadelUserMsg_ForceShopClosed: [];
    CitadelScoreboardToggle: [];
    CitadelToggleEscapeMenu: [];
    CitadelPaused: [];
    CitadelResumePlaying: [];
    CitadelQuickbuyItemsChanged: [];
    CitadelColorPickerColorChanged: [color: string];
    ClientUI_FireOutput: [payload: string];
    Activated: [];
    /** CitadelHTMLPanel: page's document.title changed. Fires twice per navigation: dedupe on content. */
    HTMLTitle: [title: string];
    HTMLFinishRequest: [url: string, title: string];
    HTMLURLChanged: [url: string];
    ImageFailedLoad: [];
    DragStart: [panel: Panel, drag: object];
    DragEnd: [panel: Panel, dragged: Panel];
    DragEnter: [panel: Panel, dragged: Panel];
    DragLeave: [panel: Panel, dragged: Panel];
    DragDrop: [panel: Panel, dragged: Panel];
}

type ScheduleHandle = number;
type UnhandledEventHandle = number;

// ============================================================================ $

interface PanoramaDollar {
    /** Find a panel in this layout by "#id". */
    (selector: string): Panel | null;

    /** Log to the console / Panorama debugger. */
    Msg(...args: unknown[]): void;
    Warning(...args: unknown[]): void;

    /**
     * Run `callback` after `seconds`. The only timer Panorama has. Frame-bound:
     * at most once per frame, so 0.01 means "next frame".
     */
    Schedule(seconds: number, callback: () => void): ScheduleHandle;
    /** Throws if the handle already fired; wrap in try/catch. */
    CancelScheduled(handle: ScheduleHandle): void;

    DispatchEvent<K extends keyof PanoramaDispatchEvents>(event: K, ...args: PanoramaDispatchEvents[K]): void;
    /** Any other event name. Known names must match their argument list above. */
    DispatchEvent<E extends string>(event: E extends keyof PanoramaDispatchEvents ? never : E, ...args: unknown[]): void;
    DispatchEventAsync<K extends keyof PanoramaDispatchEvents>(delay: number, event: K, ...args: PanoramaDispatchEvents[K]): void;
    DispatchEventAsync<E extends string>(delay: number, event: E extends keyof PanoramaDispatchEvents ? never : E, ...args: unknown[]): void;

    /** Listen for an event that bubbles up unhandled. Global to this context. */
    RegisterForUnhandledEvent<K extends keyof PanoramaListenEvents>(event: K, handler: (...args: PanoramaListenEvents[K]) => void): UnhandledEventHandle;
    RegisterForUnhandledEvent<E extends string>(event: E extends keyof PanoramaListenEvents ? never : E, handler: (...args: any[]) => void): UnhandledEventHandle;
    UnregisterForUnhandledEvent(event: string, handle: UnhandledEventHandle): void;
    /** Listen for an event on a specific panel. Use this (not SetPanelEvent) for HTML* events. */
    RegisterEventHandler<K extends keyof PanoramaListenEvents>(event: K, panel: Panel | string, handler: (...args: PanoramaListenEvents[K]) => void): void;
    RegisterEventHandler<E extends string>(event: E extends keyof PanoramaListenEvents ? never : E, panel: Panel | string, handler: (...args: any[]) => void): void;

    /**
     * Global hotkey. Pass "" (or a panel) as the first argument; mods usually register both.
     * Key names look like "key_m", "key_h", "key_f1".
     */
    RegisterKeyBind(panel: Panel | "", key: string, handler: () => void): void;

    CreatePanel(type: "Label", parent: Panel, id: string, properties?: Record<string, unknown>): Label;
    CreatePanel(type: "TextEntry", parent: Panel, id: string, properties?: Record<string, unknown>): TextEntry;
    CreatePanel(type: "Image", parent: Panel, id: string, properties?: Record<string, unknown>): ImagePanel;
    CreatePanel(type: "CitadelHTMLPanel", parent: Panel, id: string, properties?: Record<string, unknown>): CitadelHTMLPanel;
    CreatePanel(type: CreatablePanelType, parent: Panel, id: string, properties?: Record<string, unknown>): Panel;
    CreatePanelWithProperties(type: CreatablePanelType, parent: Panel, id: string, properties: Record<string, unknown>): Panel;

    /** The root panel of the layout file this script was included from. */
    GetContextPanel(): Panel;
    FindChildInContext(selector: string): Panel | null;

    /** Resolve a "#Token" from the game's localisation files. */
    Localize(token: string, panel?: Panel): string;
    LocalizePlural(token: string, count: number, panel?: Panel): string;
    HTMLEscape(text: string): string;
    /** Client language, e.g. "english". */
    Language(): string;
    Each<T>(items: T[] | Record<string, T>, callback: (value: T, key: any) => void): void;

    /** Removed by Valve. Calling it logs "AsyncWebRequest has been removed." */
    AsyncWebRequest?: never;

    /** Added by hud_lookup.js when that script is included before yours. */
    ModHudLookup?: {
        /** Fast lookup of known HUD panels, e.g. "ChatInput", "damageImpactInfo", "GameTime". */
        find(id: string): Panel | null;
    };

    /** Added by chat.js (.shared). Needs hud_lookup.js included before it. */
    ModChat?: ModChat;

    /** Added by umm.js (.shared): talks to Universal Mod Manager's settings window. */
    ModUmm?: ModUmm;

    /** Added by checkm8's kill_lines.js: chat lines per hero, keyed by internal hero name. */
    ModKillLines?: Record<string, string[]>;
}

type ChatChannel = "all" | "team";

interface ModChat {
    /**
     * Open chat on `channel`, type `text` and submit it. Gives up (and closes chat) if
     * chat never opens on that channel. Ignored while another send is in progress.
     */
    send(text: string, channel: ChatChannel, options?: ModOptions): void;
    /** true from send() until the line is submitted or the attempt is abandoned. */
    isSending(): boolean;
}

interface ModUmm {
    /** Announce a mod to UMM. Its manifest is sent now and again whenever UMM says hello. */
    register(mod: UmmMod): void;
    /** UMM may send booleans as "1"/"0" after a restart. */
    toBool(value: unknown): boolean;
}

/** Passed to the shared modules by the mod using them. */
interface ModOptions {
    /** The mod's own logger, so shared scripts log under the mod's prefix and DEBUG switch. */
    log?: (message: string) => void;
    /** Return false once the mod has been replaced or unloaded; the module then stops. */
    alive?: () => boolean;
}

interface UmmMod extends ModOptions {
    id: string;
    name: string;
    /** UMM manifest entries: group, toggle, slider, select, checks, export, import. See README. */
    settings: Record<string, unknown>[];
    /** Current values, keyed by setting id. UMM prefers what it already has saved. */
    values(): Record<string, unknown>;
    /** One call per setting: on register (saved value or default) and on every change. */
    onSet(key: string, value: unknown): void;
}

declare const $: PanoramaDollar;
declare const panorama: unknown;

// ============================================================================ experimental

/** @experimental Present in some contexts only. Always: if(typeof Game !== "undefined" && Game) { ... } */
declare var Game: {
    /** Match state; 6+ observed as "match running". */
    GetState?(): number;
    Time?(): number;
    GameTime?(): number;
    GetGameTime?(): number;
    GetMapInfo?(): any;
    GetLocalPlayerInfo?(): any;
    GetLocalPlayerID?(): number;
    IsInGame?(): boolean;
} | undefined;

/** @experimental */
declare var GameUI: {
    /** Object shared between JS contexts in the same UI. Good for cross-script flags. */
    CustomUIConfig?(): Record<string, any>;
    GetCursorPosition?(): [number, number];
} | undefined;

/** @experimental */
declare var Players: {
    GetLocalPlayer?(): number;
    GetPlayerInfo?(playerId: number): any;
    GetPlayerData?(playerId: number): any;
} | undefined;

/** @experimental Dota 2 API; not observed working in Deadlock. */
declare var Entities: {
    GetLocalPlayer?(): number;
    GetAllEntities?(): number[];
    GetHealth?(entity: number): number;
    GetMaxHealth?(entity: number): number;
} | undefined;

/** @experimental Dota 2 API; not observed working in Deadlock. */
declare var GameEvents: {
    Subscribe?(event: string, handler: (data: any) => void): number;
    Unsubscribe?(handle: number): void;
} | undefined;

/** @experimental */
declare var SteamOverlayAPI: {
    OpenURL?(url: string): void;
} | undefined;

/** @experimental */
declare var GameInterfaceAPI: {
    ConsoleCommand?(command: string): void;
} | undefined;
