# deadlock-mods

Deadlock Panorama (UI) mods, plus everything needed to build, check and test them.

```
deadlock-mods/
  well_played/                 a mod: one top-level folder per mod, lowercase, no spaces
    panorama/layout/hud_damage_impact.xml   Valve's layout + our two <include>s
    panorama/scripts/hud_lookup.js          shared panel finder (copy of .shared/)
    panorama/scripts/well_played.js         the logic
  tools/                       compiler (Predi-i's, Apache-2.0): build_mod.bat / .ps1
  types/panorama.d.ts          type hints for Panorama (editor + `deno check`)
  test/                        offline tests + fake Panorama harness (Deno)
  .shared/                     canonical shared scripts (`deno task sync` copies them into mods)
  .tooling/                    deno lint plugin for Panorama rules, sync script
  .vscode/                     build/verify tasks, settings, recommended extensions
  deno.json                    tasks, lint and type-check config (workspace: test/, .tooling/)
```

The build menu treats every top-level folder as a mod except `tools`, `types`, `test`
and anything starting with `.`. Put notes or reference files in a dot-folder.

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
   No install step for the repo: Deno fetches `@std/assert` and `@std/path` from JSR on
   first run and pins them in `deno.lock`.
4. **VS Code**: open the folder and accept the recommended extensions (Deno, XML, PowerShell).
   The Deno extension takes over JS/TS checking here; the ESLint extension isn't needed.
5. **Source 2 Viewer**:
   [ValveResourceFormat releases](https://github.com/ValveResourceFormat/ValveResourceFormat/releases).
   Open `Deadlock\game\citadel\pak01_dir.vpk` to browse and decompile Valve's own
   layouts, scripts and styles. You need this to copy any layout you override.
6. **Make Deadlock load addons.** The game only reads `game\citadel\addons` if
   `game\citadel\gameinfo.gi` lists it in `SearchPaths`. If you've installed mods with
   Deadlock Mod Manager or Grimoire before, that's already done. Otherwise, install one
   of them once and let it set this up (or follow a current community guide to edit
   `gameinfo.gi` by hand). Deadlock updates can reset this file.
   **Don't also add your dev mods in the mod manager**: the compiler installs them
   itself, and two copies would both load.

### Steam launch options for testing

Deadlock → Properties → Launch Options:

```
-dev -console
```

- `-console` opens the developer console. You can also enable **Dev command console** in
  the game settings; the console key is then **F7**.
- Hantu-Raya's docs use `-dev -tools`, with **F7** opening the **Panorama debugger** and
  **F8** opening VConsole. I couldn't verify these keys myself; if F7 gives you the plain
  console instead, try `-dev -tools`.

The Panorama debugger is where you see the live panel tree (ids, classes, label text)
and script errors. You'll use it constantly.

---

## Build

### Dev loop: `deno task dev`

One command from edit to watching your mod run:

```
deno task dev [mod]
```

1. Runs `verify` (lint, types, tests). Stops if anything fails.
2. Closes Deadlock if it's running (it keeps its VPKs open and only reads addons at launch).
3. Builds the mod with the compiler in batch mode and writes it straight into your
   addons slot (`pakNN_dir.vpk`, the same slot the build menu uses).
4. Launches Deadlock through Steam with `-dev -console -condebug` for this launch only;
   your Steam launch options are untouched.
5. Follows `game\citadel\console.log` and prints only what matters:
   **your mod's lines** (green; prefixes found automatically from `$.Msg("[Prefix] ...")`
   in your scripts), **`[UMM]`** (cyan) and **script errors** (red).
   Stops when you close the game, or Ctrl+C.

Options:

| | |
|---|---|
| `deno task dev well_played` | pick the mod (optional when there's only one) |
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
task, or `tools\build_mod.bat`.

What the menu build does:

1. Deadlock is closed (BuildAndRestart).
2. The mod folder is copied into `C:\Reduced_CSDK_12\content\citadel_addons\build_well_played`.
   Your repo is never built in place.
3. Only changed files are compiled (`.js` → `.vjs_c`, `.xml` → `.vxml_c`, `.css` → `.vcss_c`).
4. The result is packed into `Deadlock\game\citadel\addons\pakXX_dir.vpk`. The build log
   prints which `XX`; the same slot is reused on every rebuild.
5. Deadlock is started again.

When it finishes, the terminal waits for a key: press **Esc** to close it.

Other VS Code tasks (Ctrl+Shift+P → *Run Task*):

- **Force rebuild current mod**: ignores the build cache. Use when a build looks stale.
- **Build (pick mod / settings)**: the compiler's interactive menu.
- **Verify (lint + types + tests)**: same as `deno task verify` (Ctrl+Shift+P → *Run Test Task*).
- **Test** / **Sync shared scripts**: `deno task test` / `deno task sync`.

Without VS Code: run `tools\build_mod.bat` and pick the mod.

---

## Loading and testing the mod in-game

### How loading works

- **Mods load when the game starts.** Deadlock mounts the VPKs in `addons` at launch, so
  after a rebuild the game has to restart. That's why the compiler is set to
  BuildAndRestart.
- **Your script runs when its layout is built**, not when the game opens. `well_played`
  rides on `hud_damage_impact.xml`, which is part of the in-match HUD. Expect it to start
  once you're in a map (hideout or match), not on the main menu.
- Hantu-Raya's notes mention `panorama_reload_layout` (with `-dev -tools`) to reload UI
  layouts without restarting. Unverified; if it works for you it's a faster loop, but it
  won't pick up a new VPK, only reload what's mounted.

### Test run for well_played

1. Build (Ctrl+Shift+B) and let Deadlock start.
2. Open the console / Panorama debugger and filter for `WellPlayed`.
3. Start a **bot match** from the Play menu. Bot heroes are real heroes, so killing one
   produces the same `killed` popup as a real kill. (Sandbox target dummies may not.)
4. Once you're in the map you should see:
   ```
   [WellPlayed] loaded (generation 1)
   ```
5. Kill a bot hero yourself:
   ```
   [WellPlayed] kill
   [WellPlayed] opening chat with `say_chat`
   [WellPlayed] sent "Well Played!"
   ```
   and "Well Played!" appears in all-chat.
6. Get an assist only (let a teammate bot finish the kill). Nothing should be sent.
7. Get two kills within 3 seconds. One message.
8. With UMM installed (next section): press Esc, open UMM, pick another message on the
   Well Played tab, close it, get a kill. The console shows
   `[WellPlayed] setting message = "GG"` when you change it, and the new text is sent.

### In-game settings (UMM)

`well_played` registers with **Universal Mod Manager** if it's installed: a separate mod
that adds a settings window to the Escape menu and saves choices between sessions.
The Well Played tab has the real settings first:

| Setting | Type | Default |
|---|---|---|
| Enabled | toggle | on |
| Message | dropdown | Well Played! |
| Channel | All chat / Team chat | All chat |
| Cooldown | slider, 1–15 s | 3 s |

Below them is an **Examples** section with one of every UMM input type. They do nothing
except log `[WellPlayed] setting example_... = ...` when changed, so you can see each
control and what value it sends. Copy whichever you need from `EXAMPLE_SETTINGS` in
`well_played.js`, and delete the section when you're done with it.

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

Every value-bearing type also takes `description` (shown under the label).
`checks` and hero icons come from UMM's source; QOL Lite, the main
user of UMM, doesn't use them, so they're the least battle-tested.

- **Message is a preset list, not free text.** UMM has no text-entry setting (only toggle,
  slider, select and checks), so the options come from `MESSAGES` in `well_played.js`.
  Add your own there and rebuild. UMM saves the chosen text, so reordering the list is
  safe; if a saved message is removed, UMM falls back to the first option.
- **No UMM, no problem.** Nobody answers the registration, so `CONFIG`'s defaults apply.
- **How it talks to UMM.** The two run in separate JS contexts, so they exchange JSON over
  `ClientUI_FireOutput`, the only event that reaches every context. The mod sends a
  `register` manifest on boot and again whenever UMM says `hello`; UMM replies with one
  `set` per setting (saved values first, then defaults) and again on every change.
  The `UMM settings` section at the bottom of `well_played.js` is the whole client; copy
  it into other mods.
- UMM isn't in this repo. Install its VPK like any other mod (it isn't a dev mod, so the
  mod manager is fine for it).

### Handy console commands

Cheat commands need `sv_cheats true`, which only works in a private/custom lobby, never
in matchmaking.

| Command | What it does |
|---|---|
| `map new_player_basics` | Load the Hero Sandbox map |
| `citadel_hero_testing_enabled true` | Show the Testing Tools menu (using it needs cheats) |
| `citadel_spawn_practice_bots true` | Spawn practice bots (count: `citadel_spawn_practice_bots_count`) |
| `citadel_hero_testing_infinite_money true` | Infinite souls and ability points |
| `healthpct 100` | Refill your health (cheats) |
| `bot_kick_all` | Remove all bots |
| `disconnect` | Back to the main menu |

Source: [deadlock.wiki Console commands](https://deadlock.wiki/Console_Commands).

### If it doesn't work

| Symptom | Likely cause | Fix |
|---|---|---|
| No `loaded` line at all | VPK not mounted | Check `gameinfo.gi` (setup step 6); confirm the `pakXX_dir.vpk` from the build log exists in `addons` |
| No `loaded` line, other mods work | Another mod also overrides `hud_damage_impact.xml` and wins | Disable other mods while testing; only one copy of a layout path loads |
| No `loaded` line after a Deadlock patch | Valve changed the layout and our stale copy broke | Re-export `hud_damage_impact.xml` from `pak01_dir.vpk`, re-add the two `<include>` lines |
| `loaded` but `kill` never appears | Kill popup changed: different id or class | Open the debugger, get a kill, inspect `#damageImpactInfo` children's classes |
| `gave up: chat never opened on the all channel` | Command name or chat channel class changed | In the debugger, open all-chat manually and check which `ChatTarget_*` class `#Chat` has; update `CHANNELS` |
| Script error in the debugger | Bug, or an API missing in this context | Read the error; anything under "experimental" in `types/panorama.d.ts` may be undefined |
| Old behaviour after a rebuild | Build cache out of sync | Run **Force rebuild current mod** |
| No Well Played tab in UMM | UMM not loaded, or it never got the manifest | Check for `[UMM] registered: well_played` in the console; both mods must be enabled |
| Tab is there but changes do nothing | `set` messages not arriving | Look for `[WellPlayed] setting ...` lines when you change a value |

### Turning it off

Delete the `pakXX_dir.vpk` the build log printed from `Deadlock\game\citadel\addons`
(with Deadlock closed). Before sharing a mod, set `DEBUG: false`.

Automated chat can get you reported if it's spammy. Keep the cooldown.

---

## Offline checks (no game needed)

```
deno task test     # test/*.test.ts against the fake Panorama in test/harness
deno task lint     # deno lint + Panorama rules (no browser globals, semicolons)
deno task check    # mod scripts against types/panorama.d.ts; tests/tooling against Deno
deno task verify   # all three
deno task sync     # copy .shared/ scripts into mods
```

The harness loads the **real** mod scripts into an isolated JS context with a fake panel
tree, a frame-stepped clock behind `$.Schedule`, and recorded `$.DispatchEvent` calls.
Tests describe the HUD (add a popup, add `killed`), make the fake game react (open chat
when it sees `say_chat`), then assert on what was dispatched.

It proves your logic against the HUD you described. It can't prove the real HUD has
that shape: build fake trees from what you see in the Panorama debugger.

---

## Type hints and lint

`deno.json` is a workspace with two kinds of code:

- **Root (mod scripts)**: `checkJs` against `types/panorama.d.ts` with only the `es2021`
  lib: no Deno, no DOM. That matches what Panorama actually has.
- **`test/` and `.tooling/`**: normal Deno TypeScript, each with its own `deno.json`.

So in VS Code (and `deno task check`) you'll get:

- autocomplete `$.` methods, panel members and known event names with their arguments
- flag `setTimeout`, `window`, `fetch` etc. (they don't exist in Panorama)
- flag typos on panels (`BHasClas`)
- make you guard `@experimental` APIs (`Game`, `GameUI`, `Players`...) with `typeof`

`deno task lint` adds a small plugin (`.tooling/lint-panorama.ts`) with two rules that
deno lint doesn't have: a friendly message for browser globals (`setTimeout` → "Use
$.Schedule"), and required semicolons, which Valve's minifier needs. `no-empty` is off
because `catch {}` is normal in Panorama code.

`deno fmt` is disabled: it would rewrite `if(` to `if (`.

Your own data on a panel must use a `__` prefix (`panel.__myFlag = true`), so typos on
real members still error. Use JSDoc for state types; `well_played.js` shows how.

The types are hand-written from what works in community mods, not from Valve. If
something works in-game but the types reject it, add it to `panorama.d.ts`.

---

## Adding a new mod

1. Create `my_mod/panorama/{layout,scripts}`. Name: lowercase, no spaces.
2. **Pick a host layout.** Your script only runs if some layout includes it. Choose a
   layout that is present when you need it and that few other mods override. Export it
   from `pak01_dir.vpk` with Source 2 Viewer into `my_mod/panorama/layout/` with the
   same file name, and add your `<include>`s inside `<scripts>`.
3. Want `hud_lookup`? Copy `.shared/hud_lookup.js` to `my_mod/panorama/scripts/` and
   include it before your script. `deno task sync` keeps all copies up to date.
4. Add `test/my_mod.test.ts`. Copy the setup from `well_played.test.ts`.
5. Ctrl+Shift+B.

---

## Panorama rules that will bite you

- **No browser.** No `window`, `document`, `fetch`, `setTimeout`, `localStorage`.
  Timers are `$.Schedule(seconds, fn)`, and run at most once per frame.
- **Each layout is its own JS context.** Two scripts in different layouts share nothing.
  To talk across contexts, dispatch `ClientUI_FireOutput` with a JSON string.
- **Panels die.** The game rebuilds parts of the HUD; calls on a destroyed panel throw.
  Check `IsValid()` before using a cached panel and look it up again when it's gone.
- **Ids repeat.** Repeated subtrees (one per player, item, slot) reuse ids. Search from the
  narrowest parent you can.
- **Most panels aren't in any XML.** The game creates them at runtime. Use the debugger.
- **Lookups that miss are expensive.** `FindChildTraverse` on a miss walks the whole
  subtree. Cache hits, poll slowly while something is absent.
- **No game data API.** You only know what the HUD displays.
- **Networking** exists only through a hidden `CitadelHTMLPanel` (a real browser):
  see Predi-i's `HTML_TRANSPORT_HANDOFF.md` in Deadlock-UI-Mods.

## Further reading

- [Predi-i/Deadlock-UI-Mods](https://github.com/Predi-i/Deadlock-UI-Mods): small, readable mods
- [civo7/QOLLOCK](https://github.com/civo7/QOLLOCK): `docs/KNOWN_GOTCHAS.md`, `docs/HELPERS.md`
- [Hantu-Raya/Deadlock-mods-collection](https://github.com/Hantu-Raya/Deadlock-mods-collection)

## Licences

See `NOTICE`. The compiler and `hud_lookup.js` are Apache-2.0 from Predi-i/Deadlock-UI-Mods.
