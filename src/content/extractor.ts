import { ClaudeSourceAdapter } from '../shared/adapters/claude';
import { ChatGPTSourceAdapter } from '../shared/adapters/chatgpt';
import { GeminiSourceAdapter } from '../shared/adapters/gemini';
import { SourceAdapter } from '../shared/adapters/base';
import { ProjectContext } from '../shared/types';

const claudeAdapter = new ClaudeSourceAdapter();
const chatgptAdapter = new ChatGPTSourceAdapter();
const geminiAdapter = new GeminiSourceAdapter();

// Pick the right adapter based on the current hostname
function getAdapter(): SourceAdapter {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com')) return chatgptAdapter;
  if (host.includes('gemini.google.com')) return geminiAdapter;
  return claudeAdapter; // default
}

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
  const host = window.location.hostname;

  // ── Claude ────────────────────────────────────────────────────────────────
  if (url.includes('chat_conversations') && host.includes('claude.ai')) {
    const messages = claudeAdapter.normalizeNetworkResponse(url, data);
    if (messages && messages.length > 0) {
      const match = url.match(/\/chat_conversations\/([a-f0-9\-]+)/);
      const uuid = match ? match[1] : `claude-${Date.now()}`;
      const title = data.name || 'Extracted Conversation';

      const project: ProjectContext = {
        id: uuid,
        title,
        sourcePlatform: 'claude',
        createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
        updatedAt: Date.now(),
        messages,
      };

      lastExtractedConversation = project;
      saveProject(project, title);
    }
  }

  // ── ChatGPT ───────────────────────────────────────────────────────────────
  if (url.includes('backend-api/conversation') && host.includes('chatgpt.com')) {
    const messages = chatgptAdapter.normalizeNetworkResponse(url, data);
    if (messages && messages.length > 0) {
      // Extract UUID from /backend-api/conversation/{uuid}
      const match = url.match(/\/conversation\/([a-f0-9\-]+)/);
      const uuid = match ? match[1] : `chatgpt-${Date.now()}`;
      const title = data.title || 'ChatGPT Conversation';

      const project: ProjectContext = {
        id: uuid,
        title,
        sourcePlatform: 'chatgpt',
        createdAt: data.create_time ? Math.floor(data.create_time * 1000) : Date.now(),
        updatedAt: Date.now(),
        messages,
      };

      lastExtractedConversation = project;
      saveProject(project, title);
    }
  }
});

function saveProject(project: ProjectContext, title: string) {
  chrome.runtime.sendMessage(
    { action: 'SAVE_CONVERSATION', payload: project },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Context Bridge] Storage messaging offline:', chrome.runtime.lastError);
      } else {
        console.log('[Context Bridge] Conversation captured:', title, response);
      }
    }
  );
}

// 3. Handle manual extraction requests from the Popup Dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Context Bridge Extractor] Message from:', sender.id || 'unknown');

  if (message.action === 'EXTRACT_CURRENT_CHAT') {
    const adapter = getAdapter();

    // Use cached API-based extraction if it matches the current URL
    if (lastExtractedConversation && window.location.href.includes(lastExtractedConversation.id)) {
      sendResponse({ success: true, data: lastExtractedConversation, source: 'network' });
      return true;
    }

    // DOM Scraper fallback
    adapter.parseDOM().then(messages => {
      if (messages.length === 0) {
        sendResponse({ success: false, error: 'No conversation messages found in DOM.' });
        return;
      }

      const host = window.location.hostname;
      const titleElement = document.querySelector('title') || document.querySelector('h1');
      const rawTitle = titleElement?.textContent?.trim() || 'Scraped Chat';
      const title = rawTitle
        .replace(' - Claude', '')
        .replace(' | ChatGPT', '')
        .replace('Gemini', '')
        .trim() || 'Scraped Chat';

      // Extract conversation ID from URL
      const matchClaude = window.location.href.match(/\/chat\/([a-f0-9\-]+)/);
      const matchGPT = window.location.href.match(/\/c\/([a-f0-9\-]+)/);
      const matchGemini = window.location.href.match(/\/app\/([a-f0-9\-]+)/);
      const id = matchClaude?.[1] || matchGPT?.[1] || matchGemini?.[1] || `scraped-${Date.now()}`;

      const sourcePlatform = host.includes('chatgpt.com') ? 'chatgpt' : 
                             host.includes('gemini.google.com') ? 'gemini' : 'claude';

      const project: ProjectContext = {
        id,
        title,
        sourcePlatform,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages,
      };

      saveProject(project, title);
      sendResponse({ success: true, data: project, source: 'dom_fallback' });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });

    return true; // Keep message channel open for async DOM parsing
  }
});

// Trigger injection
injectNetworkHook();

// ── Gemini Auto-Scraper (DOM-based) ──────────────────────────────────────────
// Since we don't intercept Gemini's obfuscated network requests, we use a
// MutationObserver to automatically trigger DOM scraping when the chat updates.
if (window.location.hostname.includes('gemini.google.com')) {
  let scrapeTimeout: any = null;
  let lastMessageCount = 0;

  const performAutoScrape = async () => {
    try {
      const messages = await geminiAdapter.parseDOM();
      // Only save if we actually have messages and the count has changed (or it's the first scrape)
      if (messages.length > 0 && messages.length !== lastMessageCount) {
        lastMessageCount = messages.length;
        
        const titleElement = document.querySelector('title') || document.querySelector('h1');
        const title = (titleElement?.textContent?.trim() || 'Gemini Chat').replace('Gemini', '').trim() || 'Gemini Chat';
        
        const matchGemini = window.location.href.match(/\/app\/([a-f0-9\-]+)/);
        const id = matchGemini?.[1] || `scraped-${Date.now()}`;

        const project: ProjectContext = {
          id,
          title,
          sourcePlatform: 'gemini',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages,
        };

        lastExtractedConversation = project;
        saveProject(project, title);
      }
    } catch (e) {
      // ignore
    }
  };

  const observer = new MutationObserver(() => {
    if (scrapeTimeout) clearTimeout(scrapeTimeout);
    scrapeTimeout = setTimeout(performAutoScrape, 2000); // 2 second debounce
  });

  observer.observe(document.body, { childList: true, subtree: true });
  
  // Trigger initial scrape after a short delay to let the page load
  setTimeout(performAutoScrape, 3000);
}
