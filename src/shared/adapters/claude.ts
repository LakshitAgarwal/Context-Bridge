import { SourceAdapter, TargetAdapter } from './base';
import { Message } from '../types';

export class ClaudeSourceAdapter implements SourceAdapter {
  platformId = 'claude';

  detect(url: string): boolean {
    return url.includes('claude.ai');
  }

  async parseDOM(): Promise<Message[]> {
    const parsed: Message[] = [];
    
    // Select direct user and assistant text message blocks
    const textBlocks = document.querySelectorAll(
      'div.font-user, div.font-claude, [class*="font-user"], [class*="font-claude"], [data-testid="user-message"], [data-testid="assistant-message"]'
    );
    
    textBlocks.forEach(block => {
      // Exclude sidebars or menus
      if (block.closest('nav') || block.closest('header') || block.closest('[class*="sidebar"]')) {
        return;
      }

      const content = block.textContent?.trim() || '';
      if (!content) return;

      const className = block.className || '';
      const testId = block.getAttribute('data-testid') || '';
      
      let role: 'user' | 'assistant' | null = null;
      if (className.includes('font-user') || testId.includes('user') || className.includes('user-message')) {
        role = 'user';
      } else if (className.includes('font-claude') || testId.includes('assistant') || className.includes('assistant-message')) {
        role = 'assistant';
      }

      if (role) {
        // Prevent duplicate captures if elements are nested
        const lastItem = parsed[parsed.length - 1];
        if (lastItem && lastItem.content === content) return;

        parsed.push({
          role,
          content
        });
      }
    });

    return deduplicateMessages(parsed);
  }

  normalizeNetworkResponse(url: string, payload: any): Message[] | null {
    if (!url.includes('chat_conversations') && !url.includes('chat')) {
      return null;
    }

    // Try parsing chat_messages list from standard Claude JSON API
    const chatMessages = payload.chat_messages || payload.messages || [];
    if (!Array.isArray(chatMessages)) return null;

    const mapped: Message[] = chatMessages.map((msg: any) => {
      const role: "user" | "assistant" | "system" = msg.sender === 'human' ? 'user' : 'assistant';
      
      let content = '';
      // Check msg.text ONLY if it is a genuinely non-empty string.
      // Claude's API often returns text: "" for assistant messages; the real
      // content lives in the msg.content array — so we must fall through.
      if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
        content = msg.text;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((c: any) => {
            if (c.type === 'text') return c.text || '';
            if (c.type === 'tool_use') return `[Tool Use: ${c.name}]`;
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else if (typeof msg.content === 'string' && msg.content.trim().length > 0) {
        content = msg.content;
      }

      // Parse attachments
      const attachments = (msg.attachments || []).map((att: any) => ({
        name: att.file_name || att.name || 'Attachment',
        type: att.file_type || att.type || 'text/plain',
        content: att.extracted_content || att.content || ''
      }));

      return {
        role,
        content,
        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : undefined,
        attachments: attachments.length > 0 ? attachments : undefined
      };
    });

    // Drop messages with no extractable content before deduplicating
    const withContent = mapped.filter(m => m.content.trim().length > 0);
    return deduplicateMessages(withContent);
  }
}

export class ClaudeTargetAdapter implements TargetAdapter {
  platformId = 'claude';

  detect(url: string): boolean {
    return url.includes('claude.ai');
  }

  async isReady(): Promise<boolean> {
    // Only check for the editor — the file input may not exist until the user
    // interacts with the UI, so we must not block on it here.
    const editor = document.querySelector('div[contenteditable="true"]');
    return editor !== null;
  }

  async injectPrompt(text: string): Promise<boolean> {
    const editor = document.querySelector('div[contenteditable="true"]') as HTMLDivElement;
    if (!editor) return false;

    // Focus the editor first
    editor.focus();

    // Clear any existing content
    editor.innerHTML = '';

    // ── Strategy 1: Synthetic paste event via DataTransfer (Mac + Windows) ──────
    // On macOS, Chrome blocks document.execCommand unless triggered by a real
    // user gesture. A synthetic ClipboardEvent using DataTransfer bypasses this
    // and works reliably on both platforms.
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      editor.dispatchEvent(pasteEvent);

      // Check if the editor now has text content — if so, Strategy 1 succeeded
      if (editor.textContent && editor.textContent.trim().length > 0) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } catch (e) {
      console.warn('[ClaudeTargetAdapter] Strategy 1 (paste event) failed:', e);
    }

    // ── Strategy 2: execCommand insertText (Works on Windows Chrome) ────────────
    try {
      const success = document.execCommand('insertText', false, text);
      if (success && editor.textContent && editor.textContent.trim().length > 0) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } catch (e) {
      console.warn('[ClaudeTargetAdapter] Strategy 2 (execCommand) failed:', e);
    }

    // ── Strategy 3: Direct innerText + InputEvent (last resort) ─────────────────
    // Manually set the text and fire an InputEvent so the React/ProseMirror
    // virtual DOM gets notified. The Send button may not always enable itself
    // with this approach, but the text will at least be visible.
    try {
      editor.innerText = text;
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
      return true;
    } catch (e) {
      console.error('[ClaudeTargetAdapter] All injection strategies failed:', e);
    }

    return false;
  }

  async injectFile(file: File): Promise<boolean> {
    const editor = document.querySelector('div[contenteditable="true"]');
    if (!editor) return false;

    // Find the file input relative to the editor container
    const container = editor.closest('form') || editor.closest('div[class*="editor"]') || editor.closest('div[class*="input"]') || document;
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    if (!fileInput) return false;

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      
      // Dispatch both change and input events to guarantee React state updates
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Also simulate a drag-and-drop 'drop' event directly on the editor as a backup
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer
      });
      editor.dispatchEvent(dropEvent);
      
      return true;
    } catch (e) {
      console.error('[ClaudeTargetAdapter] Failed to inject file:', e);
      return false;
    }
  }
}

// deduplicate consecutive message states within the same turn
function deduplicateMessages(messages: Message[]): Message[] {
  if (messages.length <= 1) return messages;

  const cleanMessages: Message[] = [];
  let currentGroup: Message[] = [];

  for (const msg of messages) {
    if (currentGroup.length === 0 || currentGroup[0].role === msg.role) {
      currentGroup.push(msg);
    } else {
      cleanMessages.push(...filterConsecutiveGroup(currentGroup));
      currentGroup = [msg];
    }
  }
  if (currentGroup.length > 0) {
    cleanMessages.push(...filterConsecutiveGroup(currentGroup));
  }

  return cleanMessages;
}

function filterConsecutiveGroup(group: Message[]): Message[] {
  if (group.length <= 1) return group;

  // Sort by content length descending
  const sorted = [...group].map((msg, index) => ({ msg, index, text: msg.content.trim() }));
  sorted.sort((a, b) => b.text.length - a.text.length);

  const toKeep = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    let isSubset = false;

    for (const keptIndex of toKeep) {
      const kept = group[keptIndex];
      // If the candidate's text is contained within an already kept (longer) message, it's a duplicate/subset
      if (kept.content.trim().includes(candidate.text)) {
        isSubset = true;
        break;
      }
    }

    if (!isSubset && candidate.text.length > 0) {
      toKeep.add(candidate.index);
    }
  }

  return group.filter((_, index) => toKeep.has(index));
}
