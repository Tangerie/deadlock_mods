// Dev loop for Deadlock Panorama mods. Windows only (CSDK and the compiler are Windows-only).
//
//   deno task dev [mod]        build with DEBUG: true -> install into addons/deadlock_mods_dev -> launch Deadlock -> follow the log
//   deno task log [mod]        just follow the log (game already running)
//   deno task build [mod]      release VPK at tools/builds/<mod>.vpk with DEBUG: false
//
// Both builds bundle <mod>/src/main.ts into a staged copy of the mod (see bundle.ts) with DEBUG
// set for them, and compile that; the source itself is untouched.
//
// Options (after the task name):
//   --all              show every log line, not just the filtered ones
//   --filter <regex>   also show lines matching this (case-insensitive)
//   -- <flags>         extra launch flags for this run, e.g. `deno task dev -- -novid`
//
// <mod> can be left out when the repo has only one mod.
// CSDK/Steam paths come from tools/data/config.json, same as the compiler's menu.

import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, gray, green, red, yellow } from "@std/fmt/colors";
import { bundleMod, outputOf } from "./bundle.ts";

// ------------------------------------------------------------------ settings

// Flags for test launches. Added to (not replacing) your Steam launch options.
//   -dev        developer mode
//   -console    open the console on start
//   -condebug   write the console to game/citadel/console.log, which this script follows
const LAUNCH_FLAGS = ["-dev", "-console", "-condebug"];

// Shown for every mod, on top of the mod's own log prefixes.
const ALWAYS_SHOW = [/\[UMM\]/];

// Script errors and other failures worth seeing.
const ERRORS = [
    /\b(Uncaught|SyntaxError|ReferenceError|TypeError|RangeError)\b/,
    /javascript.*(error|exception)/i,
    /panorama.*(error|fail|missing|could not|unable)/i,
    /\.(vjs_c|vxml_c|vcss_c)\b.*(error|fail|missing|not found)/i,
];

const DEADLOCK_APP_ID = 1422450;
const GAME_PROCESSES = ["project8.exe", "deadlock.exe"];

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const toolsDir = join(root, "tools");
const dataDir = join(toolsDir, "data");
const buildsDir = join(toolsDir, "builds");
const NOT_MODS = new Set(["tools", "types", "test"]);

// Dev builds go in addons/<MODS_DIR>/, and only that folder is added to gameinfo.gi, so
// the loose VPKs in addons/ itself (other mods, DMM leftovers) stay unmounted.
const MODS_DIR = "deadlock_mods_dev";

// ------------------------------------------------------------------ helpers

function fail(message : string) : never {
    console.error(red("error: ") + message);
    Deno.exit(1);
}

function step(message : string) : void {
    console.log(bold(cyan("> ")) + message);
}

function exists(path : string) : boolean {
    try {
        Deno.statSync(path);
        return true;
    } catch {
        return false;
    }
}

// PowerShell 5.1 writes JSON with a BOM, which JSON.parse rejects.
function readJson(path : string) : Record<string, unknown> {
    try {
        return JSON.parse(Deno.readTextFileSync(path).replace(/^\uFEFF/, ""));
    } catch {
        return {};
    }
}

function sleep(ms : number) : Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function powershell(script : string, quiet = false) : Promise<{ ok : boolean; out : string }> {
    const result = await new Deno.Command("powershell", {
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        stdout: quiet ? "piped" : "inherit",
        stderr: quiet ? "piped" : "inherit",
    }).output();
    return { ok: result.success, out: quiet ? new TextDecoder().decode(result.stdout).trim() : "" };
}

// PowerShell single-quoted string literal.
function psQuote(text : string) : string {
    return "'" + text.replaceAll("'", "''") + "'";
}

function listMods() : string[] {
    const mods : string[] = [];
    for(const entry of Deno.readDirSync(root)) {
        if(entry.isDirectory && !entry.name.startsWith(".") && !NOT_MODS.has(entry.name)) {
            mods.push(entry.name);
        }
    }
    return mods.sort();
}

function pickMod(arg : string | undefined) : string {
    const mods = listMods();
    if(!arg) {
        if(mods.length === 1) {
            return mods[0];
        }
        fail("which mod? " + mods.join(", "));
    }
    const name = arg.replace(/[\\/]+$/, "");
    if(!mods.includes(name)) {
        fail("no mod folder '" + name + "'. Mods: " + mods.join(", "));
    }
    return name;
}

// ------------------------------------------------------------------ steam / game paths

interface GamePaths {
    steam : string;
    game : string;      // ...\steamapps\common\Deadlock
    citadel : string;   // ...\game\citadel
    addons : string;
    log : string;
}

// Same search as build_mod.ps1: config SteamPath, else the registry, else the default,
// then every Steam library in libraryfolders.vdf.
async function findGame() : Promise<GamePaths> {
    let steam = String(readJson(join(dataDir, "config.json")).SteamPath ?? "");
    if(!steam || !exists(steam)) {
        const reg = await powershell(
            "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam' -Name InstallPath -ErrorAction SilentlyContinue).InstallPath",
            true,
        );
        steam = reg.out && exists(reg.out) ? reg.out : "C:\\Program Files (x86)\\Steam";
    }

    const libraries = [steam];
    try {
        const vdf = Deno.readTextFileSync(join(steam, "steamapps", "libraryfolders.vdf"));
        for(const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
            libraries.push(match[1].replaceAll("\\\\", "\\"));
        }
    } catch {}

    for(const library of libraries) {
        const game = join(library, "steamapps", "common", "Deadlock");
        if(exists(game)) {
            const citadel = join(game, "game", "citadel");
            return {
                steam,
                game,
                citadel,
                addons: join(citadel, "addons"),
                log: join(citadel, "console.log"),
            };
        }
    }
    fail("couldn't find Deadlock. Set SteamPath in tools/data/config.json.");
}

// The game only mounts folders gameinfo.gi lists. Game updates and Deadlock Mod Manager
// (which swaps in its own profile paths) both reset that file.
// Adds `Game <searchPath>` just above the base `Game citadel` entry. Returns the new
// text, or null when the line is already there or SearchPaths has no such anchor.
export function withSearchPath(text : string, searchPath : string) : string | null {
    const escaped = searchPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if(new RegExp("^[ \\t]*Game[ \\t]+" + escaped + "[ \\t]*$", "im").test(text)) {
        return null;
    }
    const anchor = /^([ \t]*)Game([ \t]+)citadel[ \t]*$/m.exec(text);
    if(!anchor) {
        return null;
    }
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const line = anchor[1] + "Game" + anchor[2] + searchPath + eol;
    return text.slice(0, anchor.index) + line + text.slice(anchor.index);
}

function ensureModsMounted(paths : GamePaths) : void {
    const file = join(paths.citadel, "gameinfo.gi");
    try {
        const text = Deno.readTextFileSync(file);
        const patched = withSearchPath(text, "citadel/addons/" + MODS_DIR);
        if(patched === null) {
            if(!text.includes("citadel/addons/" + MODS_DIR)) {
                console.log(yellow("warning: ") + "couldn't find `Game citadel` in gameinfo.gi SearchPaths to add the mods folder before.");
            }
            return;
        }
        const backup = file + ".bak";
        if(!exists(backup)) {
            Deno.writeTextFileSync(backup, text);
        }
        Deno.writeTextFileSync(file, patched);
        step("added `Game citadel/addons/" + MODS_DIR + "` to gameinfo.gi");
    } catch(e) {
        console.log(yellow("warning: ") + "couldn't update gameinfo.gi: " + e);
    }
}

// Reuse the slot the compiler's menu uses (tools/data/mod_registry.json), so both ways
// of building overwrite the same pakNN instead of installing the mod twice.
function pakSlot(mod : string, addonsDir : string) : string {
    const registryPath = join(dataDir, "mod_registry.json");
    const registry = readJson(registryPath);
    const assigned = String(registry[mod] ?? "");
    if(/^pak(0[1-9]|[1-9][0-9])_dir\.vpk$/.test(assigned) && exists(join(addonsDir, assigned))) {
        return assigned;
    }

    const taken = new Set<number>();
    for(const entry of Deno.readDirSync(addonsDir)) {
        const match = entry.name.match(/^pak(\d{2})_(?:dir|\d{3})\.vpk$/);
        if(match) {
            taken.add(Number(match[1]));
        }
    }
    for(let n = 1; n <= 99; n++) {
        if(!taken.has(n)) {
            const slot = "pak" + String(n).padStart(2, "0") + "_dir.vpk";
            registry[mod] = slot;
            Deno.mkdirSync(dataDir, { recursive: true });
            Deno.writeTextFileSync(registryPath, JSON.stringify(registry, null, 4));
            return slot;
        }
    }
    fail("all addon slots pak01-pak99 are taken.");
}

// ------------------------------------------------------------------ game process

async function isGameRunning() : Promise<boolean> {
    const result = await new Deno.Command("tasklist", { args: ["/FO", "CSV", "/NH"], stdout: "piped", stderr: "null" }).output();
    const out = new TextDecoder().decode(result.stdout).toLowerCase();
    return GAME_PROCESSES.some((name) => out.includes("\"" + name + "\""));
}

// Deadlock keeps its VPKs open and only reads addons at launch, so it has to be closed.
async function closeGame() : Promise<void> {
    if(!(await isGameRunning())) {
        return;
    }
    step("closing Deadlock");
    await powershell("Get-Process project8, deadlock -ErrorAction SilentlyContinue | Stop-Process -Force", true);
    for(let i = 0; i < 40 && await isGameRunning(); i++) {
        await sleep(250);
    }
    // File handles can outlive the process by a moment.
    await sleep(1500);
}

async function launchGame(paths : GamePaths, extraFlags : string[]) : Promise<void> {
    const flags = [...LAUNCH_FLAGS, ...extraFlags];
    step("launching Deadlock " + gray(flags.join(" ")));
    // steam.exe -applaunch passes flags for this launch only; Steam starts itself if needed.
    const argList = ["-applaunch", String(DEADLOCK_APP_ID), ...flags].map(psQuote).join(",");
    const ok = await powershell("Start-Process -FilePath " + psQuote(join(paths.steam, "steam.exe")) + " -ArgumentList " + argList, true);
    if(!ok.ok) {
        fail("couldn't start Steam at " + join(paths.steam, "steam.exe"));
    }
}

// ------------------------------------------------------------------ build

async function compile(mod : string, output : string, source? : string) : Promise<void> {
    const args = [
        "& " + psQuote(join(toolsDir, "build_mod.ps1")),
        "-Batch",
        "-ModFolderName", mod,
        "-OutputPath", psQuote(output),
    ];
    if(source) {
        args.push("-SourcePath", psQuote(source));
    }

    // CSDK's packer (CSDKCfgVPK.exe) pops up a modal "Success" box and waits for OK,
    // which would stall an unattended build. Close that one box while the build runs.
    // Any other dialog (errors) stays up for you to read.
    const watcher = new Deno.Command("powershell", {
        args: [
            "-NoProfile", "-Command",
            "while($true) { Get-Process CSDKCfgVPK -ErrorAction SilentlyContinue | " +
                "Where-Object { $_.MainWindowTitle -eq 'Success' } | " +
                "ForEach-Object { $null = $_.CloseMainWindow() }; Start-Sleep -Milliseconds 300 }",
        ],
        stdout: "null",
        stderr: "null",
    }).spawn();

    let ok = false;
    try {
        ok = (await powershell(args.join(" "))).ok;
    } finally {
        // Kill before fail(): Deno.exit skips finally blocks and would orphan the watcher.
        try {
            watcher.kill();
        } catch {}
    }
    if(!ok) {
        fail("build failed (see the compiler output above)");
    }
}

function copyDir(from : string, to : string) : void {
    Deno.mkdirSync(to, { recursive: true });
    for(const entry of Deno.readDirSync(from)) {
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        if(entry.isDirectory) {
            copyDir(source, target);
        } else {
            Deno.copyFileSync(source, target);
        }
    }
}

// Copy the mod (minus src/) to a staging folder and bundle src/main.ts into it, with DEBUG
// set to `debug`. Source keeps DEBUG false; dev builds stage it on, release builds off.
async function stage(mod : string, debug : boolean) : Promise<string> {
    const stage = join(buildsDir, ".stage", mod);
    try {
        Deno.removeSync(stage, { recursive: true });
    } catch {}
    Deno.mkdirSync(stage, { recursive: true });
    for(const entry of Deno.readDirSync(join(root, mod))) {
        if(entry.isDirectory && entry.name !== "src") {
            copyDir(join(root, mod, entry.name), join(stage, entry.name));
        }
    }

    try {
        await bundleMod(mod, outputOf(mod, join(buildsDir, ".stage")), debug);
    } catch(e) {
        fail((e as Error).message);
    }
    step("bundled " + mod + "/src with DEBUG " + (debug ? "on" : "off"));
    return stage;
}

// ------------------------------------------------------------------ log

// The mod's own log prefixes, taken from its source: $.Msg("[Tangerie] " + ...) -> Tangerie.
export function modPrefixes(mod : string, modsRoot = root) : string[] {
    const prefixes = new Set<string>();
    const scan = (dir : string) => {
        if(!exists(dir)) {
            return;
        }
        for(const entry of Deno.readDirSync(dir)) {
            const path = join(dir, entry.name);
            if(entry.isDirectory) {
                scan(path);
                continue;
            }
            if(!entry.name.endsWith(".ts")) {
                continue;
            }
            for(const match of Deno.readTextFileSync(path).matchAll(/\$\.(?:Msg|Warning)\(\s*["'`]\[([^\]"'`]+)\]/g)) {
                prefixes.add(match[1]);
            }
        }
    };
    scan(join(modsRoot, mod, "src"));
    return [...prefixes];
}

export type LineKind = "error" | "mod" | "umm" | "other";

export function makeClassifier(prefixes : string[], extra : RegExp | null) {
    const escape = (s : string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mine = prefixes.length ? new RegExp("\\[(" + prefixes.map(escape).join("|") + ")\\]") : null;

    return (line : string) : LineKind | null => {
        if(ERRORS.some((re) => re.test(line))) {
            return "error";
        }
        if(mine && mine.test(line)) {
            return "mod";
        }
        if(ALWAYS_SHOW.some((re) => re.test(line))) {
            return "umm";
        }
        if(extra && extra.test(line)) {
            return "other";
        }
        return null;
    };
}

function printLine(line : string, kind : LineKind) : void {
    if(kind === "error") {
        console.log(red(line));
    } else if(kind === "mod") {
        console.log(green(line));
    } else if(kind === "umm") {
        console.log(cyan(line));
    } else {
        console.log(line);
    }
}

// Reads whatever was appended to a file since the last poll, as whole lines.
// Handles a line split across polls and the file being recreated (new launch).
export class LogTail {
    private offset = 0;
    private partial = "";
    private decoder = new TextDecoder();

    constructor(private path : string) {}

    poll() : string[] {
        let size = 0;
        try {
            size = Deno.statSync(this.path).size;
        } catch {
            return [];
        }
        if(size < this.offset) {
            this.offset = 0;
            this.partial = "";
            this.decoder = new TextDecoder();
        }
        if(size === this.offset) {
            return [];
        }

        const file = Deno.openSync(this.path, { read: true });
        try {
            file.seekSync(this.offset, Deno.SeekMode.Start);
            const buffer = new Uint8Array(size - this.offset);
            let read = 0;
            while(read < buffer.length) {
                const n = file.readSync(buffer.subarray(read));
                if(n === null || n === 0) {
                    break;
                }
                read += n;
            }
            this.offset += read;
            this.partial += this.decoder.decode(buffer.subarray(0, read), { stream: true });
        } finally {
            file.close();
        }

        const lines = this.partial.split(/\r?\n/);
        this.partial = lines.pop() ?? "";
        return lines;
    }
}

// Follow console.log like `tail -f`, until the game closes or Ctrl+C.
async function followLog(paths : GamePaths, mod : string, showAll : boolean, extra : RegExp | null) : Promise<void> {
    const prefixes = modPrefixes(mod);
    const classify = makeClassifier(prefixes, extra);
    step("following " + paths.log);
    step("showing " + (showAll ? "everything" : [...prefixes.map((p) => "[" + p + "]"), "[UMM]", "script errors"].join(", ")) + gray("   (Ctrl+C to stop)"));

    // Wait for the game to create the file (it's written because of -condebug).
    let waited = 0;
    while(!exists(paths.log)) {
        if(waited === 120) {
            console.log(yellow("warning: ") + "no console.log after 60s. Is -condebug reaching the game?");
        }
        await sleep(500);
        waited++;
    }

    const tail = new LogTail(paths.log);
    let sawGame = false;
    let lastProcessCheck = 0;

    while(true) {
        for(const line of tail.poll()) {
            const kind = classify(line);
            if(kind || showAll) {
                printLine(line, kind ?? "other");
            }
        }

        // Stop when the game closes.
        const now = Date.now();
        if(now - lastProcessCheck > 3000) {
            lastProcessCheck = now;
            const running = await isGameRunning();
            if(running) {
                sawGame = true;
            } else if(sawGame) {
                step("Deadlock closed");
                return;
            }
        }

        await sleep(250);
    }
}

// ------------------------------------------------------------------ main

export interface DevArgs {
    mode : "dev" | "log" | "release";
    mod : string | undefined;
    showAll : boolean;
    filter : RegExp | null;
    launchFlags : string[];
}

// Everything after `--` is launch flags for the game, never options for this script.
export function parseArgs(args : string[]) : DevArgs {
    const dashDash = args.indexOf("--");
    const own = dashDash === -1 ? args : args.slice(0, dashDash);
    const filterIndex = own.indexOf("--filter");
    return {
        mode: own.includes("--release") ? "release" : own.includes("--log-only") ? "log" : "dev",
        mod: own.find((arg, i) => !arg.startsWith("--") && own[i - 1] !== "--filter"),
        showAll: own.includes("--all"),
        filter: filterIndex !== -1 && own[filterIndex + 1] ? new RegExp(own[filterIndex + 1], "i") : null,
        launchFlags: dashDash === -1 ? [] : args.slice(dashDash + 1),
    };
}

async function main() : Promise<void> {
    if(Deno.build.os !== "windows") {
        fail("this needs Windows (CSDK, the compiler and Deadlock).");
    }

    const args = parseArgs(Deno.args);
    const mod = pickMod(args.mod);

    if(args.mode === "release") {
        const output = join(buildsDir, mod + ".vpk");
        step("release build of " + mod);
        await compile(mod, output, await stage(mod, false));
        Deno.removeSync(join(buildsDir, ".stage"), { recursive: true });
        step("done: " + output);
        return;
    }

    const paths = await findGame();
    if(args.mode === "log") {
        await followLog(paths, mod, args.showAll, args.filter);
        return;
    }

    const modsDir = join(paths.addons, MODS_DIR);
    Deno.mkdirSync(modsDir, { recursive: true });
    const output = join(modsDir, pakSlot(mod, modsDir));

    await closeGame();
    ensureModsMounted(paths);
    step("building " + mod + " -> " + output);
    await compile(mod, output, await stage(mod, true));
    Deno.removeSync(join(buildsDir, ".stage"), { recursive: true });

    // Fresh log per run, so old lines don't scroll past.
    try {
        Deno.removeSync(paths.log);
    } catch {}

    await launchGame(paths, args.launchFlags);
    await followLog(paths, mod, args.showAll, args.filter);
}

if(import.meta.main) {
    await main();
}
