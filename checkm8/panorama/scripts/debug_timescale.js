(() => {
    "use strict";

    // Debug only: F12 cycles normal -> 10% -> frozen -> normal.
    // Remove the <include> in hud_damage_impact.xml before shipping.

    const KEY = "key_f12";

    const STEPS = [
        { name: "normal", timescale: 1 },
        { name: "10%", timescale: 0.1 },
        // Untested whether Deadlock accepts 0. If it doesn't, use 0.001.
        { name: "frozen", timescale: 0 },
    ];

    // The bind is registered globally and on the panel. If both fire for one press,
    // the second is ignored so the cycle doesn't skip a step.
    const DEBOUNCE_MS = 100;

    let index = 0;
    let lastPress = 0;

    function runCommand(command) {
        try {
            $.DispatchEvent("CitadelConCommand", command);
        } catch(e) {
            $.Msg("[Tangerie] command failed: " + command + " (" + e + ")");
        }
    }

    function cycle() {
        const now = Date.now();
        if(now - lastPress < DEBOUNCE_MS) {
            return;
        }
        lastPress = now;

        index = (index + 1) % STEPS.length;
        const step = STEPS[index];

        runCommand("sv_cheats 1");
        runCommand("host_timescale " + step.timescale);
        $.Msg("[Tangerie] timescale: " + step.name + " (" + step.timescale + ")");
    }

    $.RegisterKeyBind("", KEY, cycle);
    $.RegisterKeyBind($.GetContextPanel(), KEY, cycle);
})();
