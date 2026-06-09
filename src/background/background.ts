import { ContextBridgeDB } from '../shared/db';
import { prepareChunks } from '../shared/transfer';

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

  // 2. Prepare chunks and trigger target platform context loading
  if (message.action === 'RESTORE_CONVERSATION') {
    const { projectId } = message.payload;
    
    ContextBridgeDB.getProject(projectId)
      .then((project) => {
        if (!project) {
          sendResponse({ success: false, error: 'Target conversation project not found.' });
          return;
        }

        // Compile prompt packages (using 4000 token heuristics limit)
        const chunkInfo = prepareChunks(project.messages, 4000);
        
        const session = {
          chunks: chunkInfo.chunks,
          currentIndex: 0,
          title: project.title
        };

        // Cache session context locally so content script in new tab can fetch it
        chrome.storage.local.set({ context_restoration_session: session }, () => {
          // Open target workspace new chat session
          chrome.tabs.create({ url: 'https://claude.ai/new' }, (tab) => {
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
