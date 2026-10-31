// Re-exports Valve's current layout from pak01_dir.vpk and re-injects the mod's scripts.
//
//   deno task pull [mod]             overwrite <mod>/panorama/layout/*.xml with a fresh copy + our <include>s
//   deno task pull [mod] --check     don't write, just say whether Valve's layout changed since the last pull
//
// Which layouts: every .xml already in <mod>/panorama/layout/ (that's the "host layout").
// Which scripts: every .js in <mod>/panorama/scripts/, hud_lookup first.
//
// Needs Source2Viewer-CLI.exe (the console build of Source 2 Viewer; the Source2Viewer.exe
// in the CSDK folder is the GUI and can't do this). Found in, in order:
//   $SOURCE2VIEWER_CLI, tools/data/config.json "Source2ViewerCli", <CsdkPath>, .tooling/bin, PATH.
// Download: https://github.com/ValveResourceFormat/ValveResourceFormat/releases

import { dirname, fromFileUrl, join } from "@std/path";
import { bold, cyan, gray, green, red, yellow } from "@std/fmt/colors";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const dataDir = join(root, "tools", "data");
const NOT_MODS = new Set(["tools", "types", "test"]);
const CLI_NAME = "Source2Viewer-CLI.exe";

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

// ------------------------------------------------------------------ finding things

async function powershell(script : string) : Promise<string> {
    const result = await new Deno.Command("powershell", {
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        stdout: "piped",
        stderr: "null",
    }).output();
    return new TextDecoder().decode(result.stdout).trim();
}

// Same search as dev.ts: config SteamPath, else the registry, else the default,
// then every Steam library in libraryfolders.vdf.
async function findPak01() : Promise<string> {
    let steam = String(readJson(join(dataDir, "config.json")).SteamPath ?? "");
    if(!steam || !exists(steam)) {
        const reg = await powershell(
            "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam' -Name InstallPath -ErrorAction SilentlyContinue).InstallPath",
        );
        steam = reg && exists(reg) ? reg : "C:\\Program Files (x86)\\Steam";
    }

    const libraries = [steam];
    try {
        const vdf = Deno.readTextFileSync(join(steam, "steamapps", "libraryfolders.vdf"));
        for(const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
            libraries.push(match[1].replaceAll("\\\\", "\\"));
        }
    } catch {}

    for(const library of libraries) {
        const pak = join(library, "steamapps", "common", "Deadlock", "game", "citadel", "pak01_dir.vpk");
        if(exists(pak)) {
            return pak;
        }
    }
    fail("couldn't find Deadlock's pak01_dir.vpk. Set SteamPath in tools/data/config.json.");
}

async function findCli() : Promise<string> {
    const config = readJson(join(dataDir, "config.json"));
    const candidates = [
        Deno.env.get("SOURCE2VIEWER_CLI") ?? "",
        String(config.Source2ViewerCli ?? ""),
        join(String(config.CsdkPath ?? ""), CLI_NAME),
        join(root, ".tooling", "bin", CLI_NAME),
    ];
    for(const candidate of candidates) {
        if(candidate && exists(candidate)) {
            return candidate;
        }
    }
    const onPath = (await powershell("(Get-Command Source2Viewer-CLI -ErrorAction SilentlyContinue).Source")).split("\n")[0].trim();
    if(onPath && exists(onPath)) {
        return onPath;
    }
    fail(
        CLI_NAME + " not found. Download the CLI build from\n" +
        "  https://github.com/ValveResourceFormat/ValveResourceFormat/releases\n" +
        "and put it in " + join(root, ".tooling", "bin") + " (or set $SOURCE2VIEWER_CLI).\n" +
        "The Source2Viewer.exe in the CSDK folder is the GUI and has no command line.",
    );
}

// ------------------------------------------------------------------ export

// Decompiles panorama/layout/<name>.vxml_c out of the VPK and returns the XML text.
async function exportLayout(cli : string, pak : string, name : string, outDir : string) : Promise<string> {
    // A filter that matches one file makes the CLI treat a missing -o path as the file's name, not a folder.
    Deno.mkdirSync(outDir, { recursive: true });
    const result = await new Deno.Command(cli, {
        args: ["-i", pak, "-o", outDir, "-d", "-f", "panorama/layout/" + name + ".vxml_c"],
        stdout: "piped",
        stderr: "piped",
    }).output();
    const log = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

    // The CLI's output layout has changed between releases, so find the file instead of assuming a path.
    const found = findFile(outDir, name + ".xml");
    if(!found) {
        fail("export of " + name + " failed" + (result.success ? " (no file written)" : "") + ":\n" + gray(log.trim()));
    }
    return Deno.readTextFileSync(found);
}

function findFile(dir : string, fileName : string) : string | null {
    for(const entry of Deno.readDirSync(dir)) {
        const path = join(dir, entry.name);
        if(entry.isDirectory) {
            const hit = findFile(path, fileName);
            if(hit) {
                return hit;
            }
        } else if(entry.name === fileName) {
            return path;
        }
    }
    return null;
}

// ------------------------------------------------------------------ inject

const INCLUDE = /^[ \t]*<include\s+src="s2r:\/\/panorama\/scripts\/([^"]+)\.vjs_c"\s*\/>[ \t]*\r?\n/gim;

// hud_lookup first (the mod scripts use it), then the rest alphabetically.
function scriptNames(mod : string) : string[] {
    const dir = join(root, mod, "panorama", "scripts");
    const names = [...Deno.readDirSync(dir)]
        .filter((entry) => entry.isFile && entry.name.endsWith(".js"))
        .map((entry) => entry.name.slice(0, -3))
        .sort();
    return [...names.filter((n) => n === "hud_lookup"), ...names.filter((n) => n !== "hud_lookup")];
}

// Removes the includes we add (any script this mod ships), leaves Valve's own alone.
function stripOurs(xml : string, ours : string[]) : string {
    return xml
        .replace(INCLUDE, (line, name) => ours.includes(name) ? "" : line)
        .replace(/^[ \t]*<scripts>\s*<\/scripts>[ \t]*\r?\n/m, "");
}

const BASE_STYLES = "s2r://panorama/styles/citadel_base_styles.vcss_c";

// The decompiler writes source names (.vcss, .vjs); the compiler wants the compiled ones the
// game loads (.vcss_c, .vjs_c). Also makes sure the base styles are there: every HUD layout
// relies on them, and they don't always survive the export.
function fixIncludes(xml : string) : string {
    const eol = xml.includes("\r\n") ? "\r\n" : "\n";
    let fixed = xml.replace(/(<include\s+src="s2r:\/\/[^"]+\.(?:vcss|vjs|vxml))"/g, "$1_c\"");
    if(!fixed.includes(BASE_STYLES)) {
        const open = /<styles>[ \t]*\r?\n([ \t]*)/.exec(fixed);
        if(open) {
            const at = open.index + open[0].length - open[1].length;
            fixed = fixed.slice(0, at) + open[1] + "<include src=\"" + BASE_STYLES + "\" />" + eol + fixed.slice(at);
        }
    }
    return fixed;
}

// One level of indentation, taken from the file (Valve's exports use tabs).
function unit(xml : string) : string {
    return /^([ \t]+)</m.exec(xml)?.[1] ?? "    ";
}

// Adds our includes to Valve's <scripts> block, creating one when Valve's layout has none.
// Order in a layout is <styles>, <scripts>, <snippets>, so a new block goes right after </styles>.
function inject(xml : string, ours : string[]) : string {
    const eol = xml.includes("\r\n") ? "\r\n" : "\n";
    const block = (indent : string) => ours.map((n) => indent + "<include src=\"s2r://panorama/scripts/" + n + ".vjs_c\" />").join(eol);

    const close = /^([ \t]*)<\/scripts>/m.exec(xml);
    if(close) {
        const indent = (/^([ \t]+)<include/m.exec(xml)?.[1]) ?? close[1] + unit(xml);
        return xml.slice(0, close.index) + block(indent) + eol + xml.slice(close.index);
    }

    const anchor = /<\/styles>[ \t]*\r?\n/.exec(xml) ?? /<root>[ \t]*\r?\n/.exec(xml);
    if(!anchor) {
        fail("layout has neither <styles> nor <root>: can't tell where <scripts> goes.");
    }
    const at = anchor.index + anchor[0].length;
    const one = unit(xml);
    const scripts = one + "<scripts>" + eol + block(one + one) + eol + one + "</scripts>" + eol;
    return xml.slice(0, at) + scripts + xml.slice(at);
}

function headerComment(ours : string[]) : string {
    return "<!--\n    Copy of Valve's native layout, exported by `deno task pull`.\n    Only change: the script includes (" + ours.join(", ") + "). Re-run `deno task pull` after a Deadlock update.\n-->";
}

function normalise(xml : string) : string {
    return xml.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ main

const args = Deno.args.filter((arg) => !arg.startsWith("--"));
const checkOnly = Deno.args.includes("--check");
const mod = pickMod(args[0]);

const layoutDir = join(root, mod, "panorama", "layout");
const layouts = exists(layoutDir)
    ? [...Deno.readDirSync(layoutDir)].filter((entry) => entry.isFile && entry.name.endsWith(".xml")).map((entry) => entry.name.slice(0, -4))
    : [];
if(!layouts.length) {
    fail(mod + "/panorama/layout/ has no .xml. Create an empty <layout>.xml there to say which layout to host the scripts in.");
}

const ours = scriptNames(mod);
const cli = await findCli();
const pak = await findPak01();
step("exporting " + layouts.join(", ") + " from " + pak);

const tmp = Deno.makeTempDirSync({ prefix: "deadlock_pull_" });
let outdated = 0;
try {
    for(const name of layouts) {
        const target = join(layoutDir, name + ".xml");
        const current = Deno.readTextFileSync(target);
        const valve = fixIncludes((await exportLayout(cli, pak, name, join(tmp, name))).replace(/^\uFEFF/, ""));

        // Compare against our copy minus our includes, so only Valve-side changes count.
        const changed = normalise(valve) !== normalise(stripOurs(current, ours));
        if(changed) {
            outdated++;
        }

        if(checkOnly) {
            console.log((changed ? yellow("changed  ") : green("same     ")) + name + ".xml");
            continue;
        }

        const eol = current.includes("\r\n") ? "\r\n" : "\n";
        const body = inject(stripOurs(valve, ours), ours);
        Deno.writeTextFileSync(target, headerComment(ours) + eol + eol + body.replace(/^\s+/, ""));
        console.log((changed ? green("updated  ") : gray("no change ")) + name + ".xml" + gray("  (" + ours.join(", ") + ")"));
    }
} finally {
    Deno.removeSync(tmp, { recursive: true });
}

if(checkOnly && outdated) {
    console.log(yellow("\nValve changed " + outdated + " layout(s). Run `deno task pull " + mod + "` to refresh."));
    Deno.exit(1);
}
