# deadlock-mods

Deadlock Panorama (UI) mods, plus everything needed to build, check and run them.

```
deadlock-mods/
  checkm8/                     a mod: one top-level folder per mod, lowercase, no spaces
    panorama/layout/hud_damage_impact.xml   Valve's layout + our <include>s (deno task pull)
    panorama/scripts/hud_lookup.js          shared: fast HUD panel lookup     (copy of .shared/)
    panorama/scripts/chat.js                shared: send a line in chat       (copy of .shared/)
    panorama/scripts/umm.js                 shared: in-game settings via UMM  (copy of .shared/)
    panorama/scripts/kill_lines.js          what to say after a kill, per hero
    panorama/scripts/checkm8.js             kill + hero detection, settings; starts everything
  tools/                       compiler (Predi-i's, Apache-2.0): build_mod.bat / .ps1
  types/panorama.d.ts          type hints for Panorama and the shared $.Mod* scripts
  .shared/                     canonical shared scripts (`deno task sync` copies them into mods)
  .tooling/                    dev loop, layout pull, sync, deno lint plugin for Panorama rules
  .vscode/                     build/verify tasks, settings, recommended extensions
  deno.jsonc                   tasks, lint and type-check config (workspace: .tooling/)
```

The build menu treats every top-level folder as a mod except `tools`, `types`, `test`
and anything starting with `.`. Put notes or reference files in a dot-folder.

---

## Checkm8

Sends a chat line when **you** get a kill (not an assist), picked at random from your
hero's list in `kill_lines.js`. Out of the box only Solomon has a line ("Checkmate");
every other hero's list is empty, so nothing is sent while playing them.

```js
$.ModKillLines = {
    atlas: [],                   // Abrams
    ...
    chessmaster: ["Checkmate"],  // Solomon
    ...
};
```

- **Keys are the game's internal hero names**, not display names (Solomon is `chessmaster`,
  Paige is `bookworm`). The comment after each gives the display name.
- **How the hero is found:** the shop panel (`#CitadelHudHeroShop`) carries a
  `hero_<internal name>` class for the hero you're playing. This works on any client language.
  The player APIs (`Game`, `Players`) return nothing in this context, and the hero
  portraits expose nothing to scripts.
- **How a kill is found:** a popup under `#damageImpactInfo` gets the class `killed`
  without `assist`.
- A hero added to the game after the list was made sends nothing until you add it.

---

## One-time setup

1. **Reduced CSDK 12**: download from
   [deadlockmodding.pages.dev/modding-tools/csdk-12](https://deadlockmodding.pages.dev/modding-tools/csdk-12)
   and unzip to `C:\Reduced_CSDK_12`. Not in Desktop/Documents/anything OneDrive syncs.
   Steam must be running whenever you build.
2. **Compiler config**: `tools/data/config.json` ships preset to:
   - `BuildDestination: Addons`: packs straight into `Deadlock\game\citadel\addons\pakXX_dir.vpk`
   - `ExecutionMode: BuildAndRestart`: closes Deadlock before building and starts it after
   - `CsdkPath: C:\Reduced_CSDK_12`: change it if you put CSDK elsewhere

   `tools/data/` is gitignored (it also holds the build cache), so this is per-machine.
   You can also change these from the build menu: **[0] Settings**.
3. **Deno 2.x**: `irm https://deno.land/install.ps1 | iex` in PowerShell, or `winget install DenoLand.Deno`.
   No install step for the repo: Deno fetches `@std/path` and `@std/fmt` from JSR on
   first run and pins them in `deno.lock`.
4. **VS Code**: open the folder and accept the recommended extensions (Deno, XML, PowerShell).
   The Deno extension takes over JS/TS checking here; the ESLint extension isn't needed.
5. **Source 2 Viewer**:
   [ValveResourceFormat releases](https://github.com/ValveResourceFormat/ValveResourceFormat/releases).
   Open `Deadlock\game\citadel\pak01_dir.vpk` to browse and decompile Valve's own
   layouts, scripts and styles. `deno task pull` needs the console build,
   `Source2Viewer-CLI.exe` (see the top of `.tooling/pull.ts` for where it looks).
6. **Make Deadlock load addons.** The game only reads `game\citadel\addons` if
   `game\citadel\gameinfo.gi` lists it in `SearchPaths`. `deno task dev` checks and adds
   its own dev folder. Deadlock updates can reset this file.
   **Don't also add your dev mods in a mod manager**: the dev loop installs them
   itself, and two copies would both load.

### Steam launch options for testing

`deno task dev` adds `-dev -console -condebug` for its own launches. To get the same when
launching from Steam: Deadlock → Properties → Launch Options → `-dev -console`.

- The console key is **F7**.
- The **Panorama debugger** (live panel tree with ids, classes and label text) opens with
  **F6**: hover a piece of the HUD and click. It slows the game while open, and its
  JavaScript console doesn't accept input here. If F6 does nothing, try `-dev -tools`.

---

## Build

### Dev loop: `deno task dev`

One command from edit to watching your mod run:

```
deno task dev [mod]
```

1. Runs `verify` (lint and type check). Stops if anything fails.
2. Closes Deadlock if it's running (it keeps its VPKs open and only reads addons at launch).
3. Builds a staged copy of the mod with **`DEBUG: true`** and writes it into your addons
   slot. The source keeps `DEBUG: false`.
4. Launches Deadlock through Steam with `-dev -console -condebug` for this launch only;
   your Steam launch options are untouched.
5. Follows `game\citadel\console.log` and prints only what matters:
   **your mod's lines** (green; prefixes found automatically from `$.Msg("[Prefix] ...")`
   in your scripts), **`[UMM]`** (cyan) and **script errors** (red).
   Stops when you close the game, or Ctrl+C.

| | |
|---|---|
| `deno task dev checkm8` | pick the mod (optional when there's only one) |
| `--all` | show every log line |
| `--filter "regex"` | also show lines matching this (case-insensitive) |
| `-- -novid +map xyz` | extra launch flags for this run |
| `deno task log` | only follow the log (game already running with `-condebug`) |
| `deno task build` | release build: `tools\builds\<mod>.vpk` with `DEBUG: false`, game untouched |

In VS Code, **Ctrl+Shift+B** runs `deno task dev` for the mod of the file you have open.

CSDK's packer pops up a "Success" box that waits for OK. The script closes that box
automatically during the build; any other dialog (an error) stays up so you can read it.
If a build seems stuck, look for a dialog behind other windows.

### Compiler menu

The build menu from Predi's compiler still works: run the **Build (pick mod / settings)**
task, or `tools\build_mod.bat`. It builds the mod folder as-is, so DEBUG stays off.

1. Deadlock is closed (BuildAndRestart).
2. The mod folder is copied into `C:\Reduced_CSDK_12\content\citadel_addons\build_<mod>`.
   Your repo is never built in place.
3. Only changed files are compiled (`.js` → `.vjs_c`, `.xml` → `.vxml_c`, `.css` → `.vcss_c`).
4. The result is packed into `Deadlock\game\citadel\addons\pakXX_dir.vpk`. The build log
   prints which `XX`; the same slot is reused on every rebuild.
5. Deadlock is started again. Press **Esc** to close the terminal afterwards.

Other VS Code tasks (Ctrl+Shift+P → *Run Task*): **Force rebuild current mod** (ignores the
build cache), **Verify**, **Sync shared scripts**.

---

## Loading and testing in game

### How loading works

- **Mods load when the game starts.** Deadlock mounts the VPKs in `addons` at launch, so
  after a rebuild the game has to restart. The dev loop does that for you.
- **Your script runs when its layout is built**, not when the game opens. Checkm8 rides on
  `hud_damage_impact.xml`, part of the in-match HUD, so it starts once you're in a map
  (hideout, sandbox or match), not on the main menu.

### Test run for checkm8

1. `deno task dev checkm8` and wait for the map.
2. You should see `[Tangerie] loaded (generation 1)`.
3. Play **Solomon** and kill a bot hero (bot heroes produce the same popup as real kills):
   ```
   [Tangerie] hero: chessmaster
   [Tangerie] kill
   [Tangerie] opening chat with `say_chat`
   [Tangerie] sent "Checkmate"
   ```
4. Get an assist only (let a teammate bot finish the kill). Nothing is logged or sent.
5. Get two kills within 3 seconds. One message.
6. Switch to **Paige** and kill something: `kill, but no lines for bookworm`, nothing sent.
7. With UMM installed: change the channel on the Checkm8 tab, see
   `[Tangerie] setting channel = "team"`, and the next kill goes to team chat.

### Handy console commands

Cheat commands need `sv_cheats true`, which only works in a private/custom lobby, never
in matchmaking.

| Command | What it does |
|---|---|
| `map new_player_basics` | Load the Hero Sandbox map |
| `citadel_hero_testing_enabled true` | Show the Testing Tools menu (using it needs cheats) |
| `citadel_spawn_practice_bots true` | Spawn practice bots (count: `citadel_spawn_practice_bots_count`) |
| `citadel_hero_testing_infinite_money true` | Infinite souls and ability points |
| `host_timescale 0.1` | Slow the game to 10% (cheats); UI timers may not slow with it |
| `healthpct 100` | Refill your health (cheats) |
| `bot_kick_all` | Remove all bots |
| `disconnect` | Back to the main menu |

Source: [deadlock.wiki Console commands](https://deadlock.wiki/Console_Commands).

### If it doesn't work

| Symptom | Likely cause | Fix |
|---|---|---|
| No `loaded` line at all | VPK not mounted, or a release build (DEBUG off) | Use `deno task dev`; check `gameinfo.gi` (setup step 6) |
| No `loaded` line, other mods work | Another mod also overrides `hud_damage_impact.xml` and wins | Disable other mods while testing; only one copy of a layout path loads |
| `not started: ... must be included before checkm8.js` | Includes missing or out of order | `deno task pull checkm8` |
| Broken after a Deadlock patch | Valve changed the layout and our copy is stale | `deno task pull checkm8 --check`, then `deno task pull checkm8` |
| `loaded` but `kill` never appears | Kill popup changed: different id or class | In the debugger, get a kill and inspect `#damageImpactInfo` children's classes |
| `hero: shop panel not found` | Shop panel moved or renamed | In the debugger, find the panel with a `hero_<name>` class for your hero |
| `gave up: chat never opened on the all channel` | Command name or chat channel class changed | In the debugger, open all-chat manually and check which `ChatTarget_*` class `#Chat` has; update `CHANNELS` in `.shared/chat.js`, then `deno task sync` |
| Script error in the console | Bug, or an API missing in this context | Anything under "experimental" in `types/panorama.d.ts` may be undefined |
| Old behaviour after a rebuild | Build cache out of sync | Run **Force rebuild current mod** |
| No Checkm8 tab in UMM | UMM not loaded, or it never got the manifest | Look for `[UMM] registered: checkm8` in the log |

### Turning it off

Delete the `pakXX_dir.vpk` the build log printed from `Deadlock\game\citadel\addons`
(with Deadlock closed). To share a mod, use `deno task build`: DEBUG is off in release builds.

Automated chat can get you reported if it's spammy. Keep the cooldown.

---

## Shared scripts

Code more than one mod could use lives in `.shared/` and is copied into each mod that
ships it (a mod can't reference files outside its own folder: each is its own VPK).

| Script | Provides | Use |
|---|---|---|
| `hud_lookup.js` | `$.ModHudLookup` | `find("ChatInput")`: fast lookup of known HUD panels. Third-party (Predi-i), don't edit |
| `chat.js` | `$.ModChat` | `send(text, "all" \| "team", { log, alive })`, `isSending()` |
| `umm.js` | `$.ModUmm` | `register({ id, name, settings, values, onSet, log, alive })`, `toBool(value)` |

- **How they connect:** scripts included by the same layout run in include order and share
  `$`. Each shared script adds one `$.Mod*` object, and the mod's main script picks it up.
  The types for all of them are in `types/panorama.d.ts`.
- **`log` and `alive`:** shared scripts log only through the `log` you pass them, so they
  follow your mod's prefix and DEBUG switch. `alive` lets them stop once your mod is
  replaced (HUD reload).
- **Include order** is set by `deno task pull`: `hud_lookup` first, then the other shared
  scripts, then the mod's own scripts, and `<mod>.js` last (it starts everything). A–Z
  within each group.
- **Editing one:** change the copy in `.shared/`, then `deno task sync` to update every mod
  that has a copy. A mod opts in by having a copy; copy the file in by hand the first time.

### In-game settings (UMM)

**Universal Mod Manager** is a separate mod that adds a settings window to the Escape
menu and saves choices between sessions. Checkm8 registers through `.shared/umm.js`
when it's installed:

| Setting | Type | Default |
|---|---|---|
| Enabled | toggle | on |
| Channel | All chat / Team chat | All chat |
| Cooldown | slider, 1–15 s | 3 s |

Setting types UMM understands, for the `settings` list you pass to `$.ModUmm.register`:

| Type | Manifest | Value UMM sends back |
|---|---|---|
| `group` | `{ type: "group", label }` | none (section header) |
| `toggle` | `id, label, default` | `true`/`false` (may be `"1"`/`"0"` after a restart) |
| `slider` | `min, max, step, unit, default` | number (may be a string) |
| `select` | `options: [{ value, label }]`, optional `sort: true` | the chosen `value` |
| `select` + icons | `icons: "hero"`, each option has `img` (e.g. `"haze"` → `images/heroes/haze_sm_psd`) | the chosen `value` |
| `checks` | `options: [{ id, label, default }]` | one `true`/`false` per option, keyed by the **option's** id |
| `export` | `id, label` | none: a copy box for **all** UMM settings, every mod |
| `import` | `id, label` | none: paste box that applies an exported string |

- Every value-bearing type also takes `description` (shown under the label).
- UMM has no free-text input.
- `checks` and hero icons come from UMM's source; QOL Lite, the main user of UMM, doesn't
  use them, so they're the least battle-tested.
- **How it talks to UMM:** the two run in separate JS contexts, so they exchange JSON over
  `ClientUI_FireOutput`, the only event that reaches every context. The mod sends a
  `register` manifest on boot and again whenever UMM says `hello`; UMM replies with one
  `set` per setting (saved values first, then defaults) and again on every change.
- **No UMM, no problem.** Nobody answers the registration, so `CONFIG`'s defaults apply.
- UMM isn't in this repo. Install its VPK like any other mod (a mod manager is fine for it).

---

## Offline checks (no game needed)

```
deno task lint     # deno lint + Panorama rules (no browser globals, semicolons)
deno task check    # mod scripts against types/panorama.d.ts; tooling against Deno
deno task verify   # both
deno task sync     # copy .shared/ scripts into mods
deno task pull checkm8 --check   # has Valve changed the layout we override?
```

---

## Type hints and lint

`deno.jsonc` is a workspace with two kinds of code:

- **Root (mod scripts and `.shared/`)**: `checkJs` against `types/panorama.d.ts` with only
  the `es2021` lib: no Deno, no DOM. That matches what Panorama actually has.
- **`.tooling/`**: normal Deno TypeScript, with its own `deno.json`.

So in VS Code (and `deno task check`) you'll get:

- autocomplete for `$.` methods, panel members, known event names and the `$.Mod*` scripts
- errors for `setTimeout`, `window`, `fetch` etc. (they don't exist in Panorama)
- errors for typos on panels (`BHasClas`)
- a nudge to guard `@experimental` APIs (`Game`, `GameUI`, `Players`...) with `typeof`

`deno task lint` adds a small plugin (`.tooling/lint-panorama.ts`) with two rules that
deno lint doesn't have: a friendly message for browser globals (`setTimeout` → "Use
$.Schedule"), and required semicolons, which Valve's minifier needs. `no-empty` is off
because `catch {}` is normal in Panorama code.

`deno fmt` is disabled: it would rewrite `if(` to `if (`.

Your own data on a panel must use a `__` prefix (`panel.__myFlag = true`), so typos on
real members still error. Use JSDoc for state types; `checkm8.js` shows how.

The types are hand-written from what works in community mods, not from Valve. If
something works in game but the types reject it, add it to `panorama.d.ts`.

---

## Adding a new mod

1. Create `my_mod/panorama/{layout,scripts}`. Name: lowercase, no spaces.
2. **Pick a host layout.** Your script only runs if some layout includes it. Choose one
   that is present when you need it and that few other mods override. Create an empty
   `my_mod/panorama/layout/<layout>.xml` with Valve's file name.
3. Copy the shared scripts you want from `.shared/` into `my_mod/panorama/scripts/`, and
   write `my_mod/panorama/scripts/my_mod.js` (it loads last; check for the `$.Mod*`
   objects you need at start, as `checkm8.js` does).
4. `deno task pull my_mod`: exports Valve's layout into that file and adds the includes.
5. Give your logs a prefix (`$.Msg("[MyMod] " + ...)`) behind a `DEBUG: false` setting;
   the dev loop finds the prefix and turns DEBUG on for dev builds.
6. Ctrl+Shift+B.

---

## Panorama rules that will bite you

- **No browser.** No `window`, `document`, `fetch`, `setTimeout`, `localStorage`.
  Timers are `$.Schedule(seconds, fn)`, and run at most once per frame.
- **Each layout is its own JS context.** Two scripts in different layouts share nothing.
  To talk across contexts, dispatch `ClientUI_FireOutput` with a JSON string.
  Scripts in the *same* layout share `$` (that's how the shared scripts work).
- **Panels die.** The game rebuilds parts of the HUD; calls on a destroyed panel throw.
  Check `IsValid()` before using a cached panel and look it up again when it's gone.
- **Ids repeat.** Repeated subtrees (one per player, item, slot) reuse ids. Search from the
  narrowest parent you can.
- **Most panels aren't in any XML.** The game creates them at runtime. Use the debugger.
- **Lookups that miss are expensive.** `FindChildTraverse` on a miss walks the whole
  subtree. Cache hits, poll slowly while something is absent.
- **No game data API.** You only know what the HUD displays: classes on panels are often
  the best signal (e.g. `hero_<name>` on the shop).
- **Networking** exists only through a hidden `CitadelHTMLPanel` (a real browser):
  see Predi-i's `HTML_TRANSPORT_HANDOFF.md` in Deadlock-UI-Mods.

## Further reading

- [Predi-i/Deadlock-UI-Mods](https://github.com/Predi-i/Deadlock-UI-Mods): small, readable mods
- [civo7/QOLLOCK](https://github.com/civo7/QOLLOCK): `docs/KNOWN_GOTCHAS.md`, `docs/HELPERS.md`
- [Hantu-Raya/Deadlock-mods-collection](https://github.com/Hantu-Raya/Deadlock-mods-collection)

## Licences

See `NOTICE`. The compiler and `hud_lookup.js` are Apache-2.0 from Predi-i/Deadlock-UI-Mods.
