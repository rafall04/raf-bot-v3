/**
 * Header Doc
 * Purpose: Mendispatch intent bot WhatsApp ke composer map-based per domain sesuai konteks actor, state, dan command.
 * Caller: `message/raf.js` melalui pipeline intent dispatcher.
 * Deps: `./raf-intent-dispatch/index`, helper auth/jid, template helper, dan `../../lib/whatsapp-gateway`.
 * MainFuncs: `resolveAgentContext`, `dispatchIntent`.
 * SideEffects: Memanggil handler domain terkelompok, membaca state global, dan meneruskan dependency runtime bot terstandar.
 */
const { getSocket } = require('../../lib/whatsapp-gateway');
const { renderResponseTemplate } = require('./template-helpers');
const { getIntentDispatchMap } = require('./raf-intent-dispatch/index');

const INTENT_DISPATCH_MAP = getIntentDispatchMap();

function resolveAgentContext({
    sender,
    msg,
    isGroup,
    raf,
    extractSenderInfo,
    agentTransactionManager,
    agentManager
}) {
    let isAgent = false;
    let agentCred = null;
    const senderInfo = extractSenderInfo(msg, isGroup);

    return (async () => {
        if (senderInfo.isLid && !senderInfo.phoneNumber && raf && raf.signalRepository) {
            const lidJid = senderInfo.originalSender;
            try {
                if (raf.signalRepository.lidMapping && raf.signalRepository.lidMapping.getPNForLID) {
                    const phoneNumberJid = await raf.signalRepository.lidMapping.getPNForLID(lidJid);
                    if (phoneNumberJid) {
                        senderInfo.phoneNumber = phoneNumberJid.split('@')[0];
                        senderInfo.method = 'signal_repository';
                    }
                }
            } catch (_error) {
            }
        }

        let phoneNumberToSearch = senderInfo.phoneNumber || sender.split('@')[0];
        phoneNumberToSearch = phoneNumberToSearch.replace(/@.*$/, '');

        agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);

        if (!agentCred && !phoneNumberToSearch.includes('@')) {
            agentCred = agentTransactionManager.getAgentByWhatsapp(`${phoneNumberToSearch}@s.whatsapp.net`);
        }

        if (!agentCred) {
            const agent = agentManager.getAgentByWhatsapp(phoneNumberToSearch);
            if (agent) {
                isAgent = true;
                agentCred = agent;
            }
        } else {
            isAgent = true;
        }

        return {
            isAgent,
            agentCred,
            senderInfo,
            phoneNumberToSearch
        };
    })();
}

function buildDispatchContext(context) {
    const runtimeSocket = getSocket();
    const renderIntentResponseTemplate = (key, fallback, data = {}) => {
        const rendered = typeof context.format === 'function' ? context.format(key, data) : '';
        return rendered && rendered.trim() ? rendered : renderResponseTemplate(key, fallback, data);
    };

    return {
        ...context,
        runtimeSocket,
        handleFinalConfirmation: context.handleCompletionConfirmation,
        renderResponseTemplate: renderIntentResponseTemplate
    };
}

async function dispatchIntent(context) {
    const dispatchContext = buildDispatchContext(context);
    const handler = INTENT_DISPATCH_MAP[dispatchContext.intent];

    if (typeof handler === 'function') {
        return await handler(dispatchContext);
    }

    if (dispatchContext.intent === 'TIDAK_DIKENALI') {
        return undefined;
    }

    return undefined;
}

module.exports = {
    resolveAgentContext,
    dispatchIntent
};
