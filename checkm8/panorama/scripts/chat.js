// Sends a line in chat: opens chat on a channel, types the text, submits it.
// Canonical copy; `deno task sync` copies it into mods. Include after hud_lookup.js.
//
//   $.ModChat.send("gg", "all", { log, alive });
//   $.ModChat.isSending();
(() => {
    "use strict";

    // Console commands that open each channel, tried in order until one works.
    // `say_chat_team` is confirmed by several mods; `say_chat` for all-chat is what
    // Well-Played-On-Kill ships with. The others are fallbacks.
    // targetClass is the class the chat panel gets for that channel.
    const CHANNELS = {
        all: { commands: ["say_chat", "say_chat_all"], targetClass: "ChatTarget_GameAll" },
        team: { commands: ["say_chat_team"], targetClass: "ChatTarget_GameAllies" },
    };
    const OTHER_TARGET_CLASSES = ["ChatTarget_GameAll", "ChatTarget_GameAllies", "ChatTarget_Team", "ChatTarget_Party"];

    // Delays between attempts to submit after opening chat. First one is next frame.
    const RETRY_DELAYS = [0, 0.016, 0.033, 0.05, 0.1, 0.2];
    // Frames the chat box must look ready before we submit.
    const CONFIRM_FRAMES = 1;

    /**
     * @type {{
     *     chatInput: TextEntry | null,
     *     chatTargetLabel: Panel | null,
     *     sending: boolean,
     *     text: string,
     *     channel: ChatChannel,
     *     options: ModOptions,
     *     attempt: number,
     *     readyFrames: number,
     *     commandIndex: number,
     * }}
     */
    const state = {
        chatInput: null,
        chatTargetLabel: null,
        sending: false,

        // The send in progress.
        text: "",
        channel: "all",
        options: {},
        attempt: 0,
        readyFrames: 0,
        commandIndex: 0,
    };

    // Index of the open command that worked for each channel. Once one works, the
    // fallbacks aren't tried again for the rest of the session.
    /** @type {Record<string, number>} */
    const confirmedCommand = {};

    function log(message) {
        if(state.options.log) {
            state.options.log(message);
        }
    }

    function isAlive() {
        return !state.options.alive || state.options.alive();
    }

    /**
     * @param {Panel | null | undefined} panel
     * @returns {panel is Panel}
     */
    function isValid(panel) {
        return !!(panel && panel.IsValid && panel.IsValid());
    }

    function hasClass(panel, className) {
        if(!isValid(panel)) {
            return false;
        }
        try {
            return panel.BHasClass(className);
        } catch {
            return false;
        }
    }

    function lookup(id) {
        try {
            const found = $.ModHudLookup ? $.ModHudLookup.find(id) : null;
            return isValid(found) ? found : null;
        } catch {
            return null;
        }
    }

    function channelInfo() {
        return CHANNELS[state.channel] || CHANNELS.all;
    }

    function findChatPanels() {
        if(isValid(state.chatInput) && isValid(state.chatTargetLabel)) {
            return true;
        }
        state.chatInput = /** @type {TextEntry | null} */ (lookup("ChatInput"));
        state.chatTargetLabel = lookup("ChatTargetLabel");
        return !!(state.chatInput && state.chatTargetLabel);
    }

    // The channel shows up as a class on one of the chat label's ancestors, e.g.
    // ChatTarget_GameAll. We check classes, not the label text, because the text is
    // translated and "(ALL)" won't match on a non-English client.
    function isTargetingChannel() {
        const target = channelInfo().targetClass;
        let cursor = state.chatTargetLabel;
        for(let depth = 0; isValid(cursor) && depth < 20; depth++) {
            if(hasClass(cursor, target)) {
                return true;
            }
            for(const other of OTHER_TARGET_CLASSES) {
                if(other !== target && hasClass(cursor, other)) {
                    return false;
                }
            }
            cursor = cursor.GetParent();
        }
        return false;
    }

    function openChat() {
        const command = channelInfo().commands[state.commandIndex];
        log("opening chat with `" + command + "`");
        try {
            $.DispatchEvent("CitadelConCommand", command);
        } catch {}
    }

    function closeChat(input) {
        try {
            $.DispatchEvent("CitadelChatInputBlur", input);
        } catch {}
        try {
            $.DispatchEvent("DropInputFocus", input);
        } catch {}
    }

    function submit() {
        const input = state.chatInput;
        if(!isValid(input)) {
            state.sending = false;
            return;
        }
        try {
            input.text = state.text;
            $.DispatchEvent("CitadelChatInputSubmitted", input);
            input.text = "";
        } catch(e) {
            log("submit failed: " + e);
            state.sending = false;
            return;
        }

        closeChat(input);
        confirmedCommand[state.channel] = state.commandIndex;
        state.sending = false;
        log("sent \"" + state.text + "\"");
    }

    // Called repeatedly after openChat() until the chat box is ready or we give up.
    function trySubmit() {
        if(!isAlive()) {
            state.sending = false;
            return;
        }

        if(findChatPanels() && isTargetingChannel()) {
            if(state.readyFrames >= CONFIRM_FRAMES) {
                submit();
                return;
            }
            state.readyFrames++;
        } else {
            state.readyFrames = 0;
        }

        state.attempt++;
        if(state.attempt < RETRY_DELAYS.length) {
            $.Schedule(RETRY_DELAYS[state.attempt], trySubmit);
            return;
        }

        // This command never got us the right channel. Try the next one.
        const confirmed = confirmedCommand[state.channel] !== undefined;
        if(!confirmed && state.commandIndex < channelInfo().commands.length - 1) {
            state.commandIndex++;
            state.attempt = 0;
            state.readyFrames = 0;
            openChat();
            $.Schedule(RETRY_DELAYS[0], trySubmit);
            return;
        }

        log("gave up: chat never opened on the " + state.channel + " channel");
        if(isValid(state.chatInput)) {
            closeChat(state.chatInput);
        }
        state.sending = false;
    }

    function send(text, channel, options) {
        if(state.sending) {
            return;
        }
        state.text = text;
        state.channel = CHANNELS[channel] ? channel : "all";
        state.options = options || {};
        state.sending = true;
        state.attempt = 0;
        state.readyFrames = 0;
        state.commandIndex = confirmedCommand[state.channel] || 0;
        openChat();
        $.Schedule(RETRY_DELAYS[0], trySubmit);
    }

    $.ModChat = {
        send,
        isSending: () => state.sending,
    };
})();
