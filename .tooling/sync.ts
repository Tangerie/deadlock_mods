// Copies shared scripts from .shared/ into every mod that ships them.
//
// Each mod is compiled into its own VPK, so it can't reference a file outside its folder.
// Keep the canonical copy in .shared/ and run `deno task sync` after changing it.
// A mod opts in by having its own copy at panorama/scripts/<name>.

import { dirname, fromFileUrl, join, relative } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const sharedDir = join(root, ".shared");
const shared = [...Deno.readDirSync(sharedDir)].filter((entry) => entry.isFile).map((entry) => entry.name);
const skip = new Set(["tools", "types", "test"]);

function readOrNull(path : string) : string | null {
    try {
        return Deno.readTextFileSync(path);
    } catch {
        return null;
    }
}

let changed = 0;
for(const entry of Deno.readDirSync(root)) {
    if(!entry.isDirectory || entry.name.startsWith(".") || skip.has(entry.name)) {
        continue;
    }

    for(const name of shared) {
        const target = join(root, entry.name, "panorama", "scripts", name);
        const current = readOrNull(target);
        if(current === null) {
            continue;
        }

        const source = Deno.readTextFileSync(join(sharedDir, name));
        if(source !== current) {
            Deno.writeTextFileSync(target, source);
            console.log("updated " + relative(root, target));
            changed++;
        }
    }
}

console.log(changed ? changed + " file(s) updated" : "all copies up to date");
