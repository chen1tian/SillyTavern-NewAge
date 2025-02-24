import { registerIframeChatMessageHandler } from "./chat_message.js";
import { registerIframeDisplayedMessageHandler } from "./displayed_message.js";
import { registerIframeEventHandler } from "./event.js";
import { registerIframeFrontendVersionHandler } from "./frontend_version.js";
import { registerIframeGenerateHandler } from "./generate.js";
import { registerIframeLorebookHandler } from "./lorebook.js";
import { registerIframeLorebookEntryHandler } from "./lorebook_entry.js";
import { registerIframeSlashHandler } from "./slash.js";
import { registerIframeTavernRegexHandler } from "./tavern_regex.js";
import { registerIframeUtilHandler } from "./util.js";
import { registerIframeVariableHandler } from "./variables.js";
export function getIframeName(event) {
    const window = event.source;
    return window.frameElement?.id;
}
export function getLogPrefix(event) {
    return `${event.data.request}(${getIframeName(event)}) `;
}
const iframe_handlers = {};
export function registerIframeHandler(request, handler) {
    iframe_handlers[request] = handler;
}
export async function handleIframe(event) {
    if (!event.data)
        return;
    const handler = iframe_handlers[event.data.request];
    if (!handler) {
        return;
    }
    let result = undefined;
    try {
        result = await handler(event);
    }
    catch (err) {
        const error = err;
        console.error(error);
    }
    finally {
        event.source.postMessage({
            request: event.data.request + "_callback",
            uid: event.data.uid,
            result: result,
        }, {
            targetOrigin: "*",
        });
    }
}
registerIframeChatMessageHandler();
registerIframeDisplayedMessageHandler();
registerIframeEventHandler();
registerIframeFrontendVersionHandler();
registerIframeGenerateHandler();
registerIframeLorebookEntryHandler();
registerIframeLorebookHandler();
registerIframeSlashHandler();
registerIframeTavernRegexHandler();
registerIframeUtilHandler();
registerIframeVariableHandler();

export {};

//# sourceMappingURL=index.js.map