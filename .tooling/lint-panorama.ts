// deno lint plugin: Panorama rules that deno lint doesn't have built in.
// Only applies to code that runs in Panorama: mod sources (<mod>/src/) and .shared/.
//
//   panorama/no-browser-globals  window, document, setTimeout... don't exist in Panorama.
//                                (deno check also catches these; this gives a useful message.)
//   panorama/semi                every statement ends in `;` (Valve's minifier relies on it).

const BROWSER_GLOBALS: Record<string, string> = {
    window: "Panorama has no window.",
    document: "Panorama has no document.",
    setTimeout: "Use $.Schedule(seconds, fn).",
    setInterval: "Use a $.Schedule loop.",
    clearTimeout: "Use $.CancelScheduled(handle).",
    requestAnimationFrame: "Use $.Schedule(0, fn) for next frame.",
    fetch: "No networking in Panorama. See the HTML bridge notes in README.",
    XMLHttpRequest: "No networking in Panorama. See the HTML bridge notes in README.",
    WebSocket: "No networking in Panorama. See the HTML bridge notes in README.",
    localStorage: "No storage in Panorama.",
    console: "Use $.Msg(...).",
};

const NEEDS_SEMICOLON = [
    "ExpressionStatement",
    "VariableDeclaration",
    "ReturnStatement",
    "BreakStatement",
    "ContinueStatement",
    "ThrowStatement",
    "DoWhileStatement",
] as const;

// Just the parts of Deno's lint plugin API this file uses. Deno doesn't ship these types
// in every release, so they're declared locally.
interface LintNode {
    type : string;
    parent : LintNode;
    name? : string;
    property? : LintNode;
    key? : LintNode;
    computed? : boolean;
    init? : LintNode | null;
    left? : LintNode;
}

interface RuleContext {
    filename : string;
    sourceCode : { getText(node : LintNode) : string };
    report(descriptor : { node : LintNode; message : string }) : void;
}

type Visitors = Partial<Record<string, (node : LintNode) => void>>;

interface LintPlugin {
    name : string;
    rules : Record<string, { create(context : RuleContext) : Visitors }>;
}

function isPanoramaScript(filename : string) : boolean {
    return /[\\/](?:src|\.shared)[\\/]/.test(filename) && !/[\\/]\.tooling[\\/]/.test(filename);
}

const plugin : LintPlugin = {
    name: "panorama",
    rules: {
        "no-browser-globals": {
            create(context) {
                if(!isPanoramaScript(context.filename)) {
                    return {};
                }

                return {
                    Identifier(node) {
                        const message = BROWSER_GLOBALS[node.name ?? ""];
                        if(!message) {
                            return;
                        }

                        // obj.setTimeout and { fetch: 1 } are fine; only bare globals count.
                        const parent = node.parent;
                        if(parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
                            return;
                        }
                        if(parent.type === "Property" && parent.key === node && !parent.computed) {
                            return;
                        }

                        context.report({ node, message: "`" + node.name + "`: " + message });
                    },
                };
            },
        },

        "semi": {
            create(context) {
                if(!isPanoramaScript(context.filename)) {
                    return {};
                }

                const visit = (node : LintNode) => {
                    const parent = node.parent;

                    // `for(let i = 0; ...)` and `for(const x of y)` declarations have no `;` of their own.
                    if(node.type === "VariableDeclaration" && parent) {
                        if(parent.type === "ForStatement" && parent.init === node) {
                            return;
                        }
                        if((parent.type === "ForOfStatement" || parent.type === "ForInStatement") && parent.left === node) {
                            return;
                        }
                    }

                    if(!context.sourceCode.getText(node).trimEnd().endsWith(";")) {
                        context.report({ node, message: "Missing semicolon (Valve's minifier needs them)." });
                    }
                };

                const visitors : Record<string, (node : LintNode) => void> = {};
                for(const type of NEEDS_SEMICOLON) {
                    visitors[type] = visit;
                }
                return visitors;
            },
        },
    },
};

export default plugin;
