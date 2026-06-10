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
          targetPlatform
        };

        // Cache session context locally so content script in new tab can fetch it
        chrome.storage.local.set({ context_restoration_session: session }, () => {
          // Open target workspace new chat session
          const url = targetPlatform === 'chatgpt' ? 'https://chatgpt.com/' : 
                      targetPlatform === 'gemini' ? 'https://gemini.google.com/app' : 'https://claude.ai/new';
          chrome.tabs.create({ url }, (tab) => {
            sendResponse({ success: true, tabId: tab.id });
          });
        });
      })
      .catch((err) => {
        console.error('[Context Bridge Service Worker] Restoration initialization error:', err);
        sendResponse({ success: false, error: err.message });
      });
      
    return true; // Keep response channel open
  }
});
export {};
