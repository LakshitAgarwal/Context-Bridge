import { ContextBridgeDB } from '../shared/db';
import { compileHistoryToMarkdown } from '../shared/transfer';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Context Bridge BG] Received action:', message.action, 'from', sender.tab?.url || 'popup');
  // 1. Save extracted conversation payload to local IndexedDB
  if (message.action === 'SAVE_CONVERSATION') {
    ContextBridgeDB.saveProject(message.payload)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('[Context Bridge Service Worker] Database save error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep response channel open
  }

  // 2. Prepare context file and trigger target platform context loading
  if (message.action === 'RESTORE_CONVERSATION') {
    const { projectId, targetPlatform = 'claude' } = message.payload;
    
    ContextBridgeDB.getProject(projectId)
      .then((project) => {
        if (!project) {
          sendResponse({ success: false, error: 'Target conversation project not found.' });
          return;
        }

        const fileContent = compileHistoryToMarkdown(project.messages);
        const sanitizedTitle = project.title.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const fileName = `restored_chat_${sanitizedTitle || 'history'}.md`;
        const promptText = `I have uploaded our previous conversation history as a file. Please read it to fully restore the context of our chat, and confirm you are ready to continue from where we left off.`;

        const session = {
          fileContent,
          fileName,
          title: project.title,
          promptText,
          targetPlatform,
          createdAt: Date.now(),
        };

        const url = targetPlatform === 'chatgpt' ? 'https://chatgpt.com/' : 
                    targetPlatform === 'gemini' ? 'https://gemini.google.com/app' : 'https://claude.ai/new';

        chrome.tabs.create({ url }, (tab) => {
          if (tab.id) {
            // Store the session in local storage but keyed by the specific tab ID
            // This is 100% foolproof against ghost injections on other tabs.
            const key = `context_restoration_tab_${tab.id}`;
            chrome.storage.local.set({ [key]: session }, () => {
              sendResponse({ success: true, tabId: tab.id });
            });
          } else {
            sendResponse({ success: false, error: 'Could not get tab ID' });
          }
        });
      })
      .catch((err) => {
        console.error('[Context Bridge Service Worker] Restoration initialization error:', err);
        sendResponse({ success: false, error: err.message });
      });
      
    return true; // Keep response channel open
  }

  // Content script asks for its session
  if (message.action === 'CLAIM_SESSION') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse(null);
      return false;
    }

    const key = `context_restoration_tab_${tabId}`;
    chrome.storage.local.get(key, (result) => {
      const session = result[key];
      if (session) {
        // Atomic claim — delete it so it only fires once per tab lifecycle
        chrome.storage.local.remove(key, () => {
          sendResponse(session);
        });
      } else {
        sendResponse(null);
      }
    });
    return true; // async response
  }
});
export {};
