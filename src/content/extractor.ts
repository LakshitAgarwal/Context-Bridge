import { ClaudeSourceAdapter } from '../shared/adapters/claude';
import { ProjectContext } from '../shared/types';

const adapter = new ClaudeSourceAdapter();
let lastExtractedConversation: ProjectContext | null = null;

// 1. Inject network hook script into MAIN page world
function injectNetworkHook() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/networkHook.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('[Context Bridge] Interception script injected successfully.');
  } catch (e) {
    console.error('[Context Bridge] Injection failure:', e);
  }
}

// 2. Capture intercepted responses from the MAIN world CustomEvent
window.addEventListener('ContextBridge_NetworkEvent', (event: any) => {
  const { url, data } = event.detail;
  
  if (url.includes('chat_conversations')) {
    const messages = adapter.normalizeNetworkResponse(url, data);
    
    if (messages && messages.length > 0) {
      // Extract chat UUID from Claude's REST API endpoint format
      const match = url.match(/\/chat_conversations\/([a-f0-9\-]+)/);
      const uuid = match ? match[1] : `claude-${Date.now()}`;
      
      const title = data.name || 'Extracted Conversation';
      const project: ProjectContext = {
        id: uuid,
        title: title,
        sourcePlatform: 'claude',
        createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
        updatedAt: Date.now(),
        messages: messages
      };
      
      lastExtractedConversation = project;
      
      // Dispatch conversation to background worker for local IndexedDB storage
      chrome.runtime.sendMessage({
        action: 'SAVE_CONVERSATION',
        payload: project
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Context Bridge] Storage messaging offline:', chrome.runtime.lastError);
        } else {
          console.log('[Context Bridge] Conversation captured via API interception:', title, response);
        }
      });
    }
  }
});

// 3. Handle manual extraction requests from the Popup Dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Context Bridge Extractor] Message from:', sender.id || 'unknown');
  if (message.action === 'EXTRACT_CURRENT_CHAT') {
    // If we have a cached API-based extraction matching the current active chat URL, prefer it
    if (lastExtractedConversation && window.location.href.includes(lastExtractedConversation.id)) {
      sendResponse({ success: true, data: lastExtractedConversation, source: 'network' });
      return true;
    }
    
    // DOM Scraper Fallback
    adapter.parseDOM().then(messages => {
      if (messages.length === 0) {
        sendResponse({ success: false, error: 'No conversation messages found in DOM.' });
        return;
      }
      
      const titleElement = document.querySelector('title') || document.querySelector('h1');
      const title = titleElement ? titleElement.textContent?.replace(' - Claude', '').trim() || 'Scraped Chat' : 'Scraped Chat';
      
      const match = window.location.href.match(/\/chat\/([a-f0-9\-]+)/);
      const id = match ? match[1] : `scraped-${Date.now()}`;

      const project: ProjectContext = {
        id,
        title,
        sourcePlatform: 'claude',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages
      };

      // Persist locally
      chrome.runtime.sendMessage({
        action: 'SAVE_CONVERSATION',
        payload: project
      });

      sendResponse({ success: true, data: project, source: 'dom_fallback' });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    
    return true; // Keep message channel open for async DOM parsing
  }
});

// Trigger injection
injectNetworkHook();
