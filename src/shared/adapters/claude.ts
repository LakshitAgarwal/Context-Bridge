import { SourceAdapter, TargetAdapter } from './base';
import { Message } from '../types';

export class ClaudeSourceAdapter implements SourceAdapter {
  platformId = 'claude';

  detect(url: string): boolean {
    return url.includes('claude.ai');
  }

  async parseDOM(): Promise<Message[]> {
    const parsed: Message[] = [];
    // Select all articles or containers that look like message bubbles
    const messageRows = document.querySelectorAll('article, div[data-testid*="message"], div.font-sans');
    
    messageRows.forEach(row => {
      // Ignore sidebars, menus, or non-message text elements
      if (row.closest('nav') || row.closest('header') || row.closest('[class*="sidebar"]')) {
        return;
      }

      // Check if it's an actual message container (heuristically)
      const hasParagraphs = row.querySelector('p, pre, ul, ol');
      if (!hasParagraphs) return;

      // Detect role: Assistant messages always contain action buttons like copy or retry
      const hasAssistantControls = row.querySelector('button[aria-label*="Copy"], button[aria-label*="copy"], button[aria-label*="Retry"], svg[class*="thumbs"]');
      const role = hasAssistantControls ? 'assistant' : 'user';

      // Compile content text from paragraphs/nodes
      const textElements = row.querySelectorAll('p, pre, ul, ol');
      let content = '';
      if (textElements.length > 0) {
        content = Array.from(textElements)
          .map(el => el.textContent || '')
          .join('\n\n');
      } else {
        content = row.textContent || '';
      }

      // Clean common UI labels
      content = content.replace(/Copy\b/g, '').trim();

      if (content.length > 0) {
        // Avoid duplicate pushes for nested containers by verifying the last item
        const lastItem = parsed[parsed.length - 1];
        if (lastItem && lastItem.content === content) return;

        parsed.push({
          role,
          content
        });
      }
    });

    return parsed;
  }

  normalizeNetworkResponse(url: string, payload: any): Message[] | null {
    if (!url.includes('chat_conversations') && !url.includes('chat')) {
      return null;
    }

    // Try parsing chat_messages list from standard Claude JSON API
    const chatMessages = payload.chat_messages || payload.messages || [];
    if (!Array.isArray(chatMessages)) return null;

    return chatMessages.map((msg: any) => {
      const role = msg.sender === 'human' ? 'user' : 'assistant';
      
      let content = '';
      if (typeof msg.text === 'string') {
        content = msg.text;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((c: any) => {
            if (c.type === 'text') return c.text || '';
            if (c.type === 'tool_use') return `[Tool Use: ${c.name}]`;
            return '';
          })
          .join('\n');
      } else if (typeof msg.content === 'string') {
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
  }
}

export class ClaudeTargetAdapter implements TargetAdapter {
  platformId = 'claude';

  detect(url: string): boolean {
    return url.includes('claude.ai');
  }

  async isReady(): Promise<boolean> {
    const editor = document.querySelector('div[contenteditable="true"]');
    return editor !== null;
  }

  async injectPrompt(text: string): Promise<boolean> {
    const editor = document.querySelector('div[contenteditable="true"]') as HTMLDivElement;
    if (!editor) return false;

    // Focus prompt window
    editor.focus();

    // Clear contents
    editor.innerHTML = '';

    // Inject text using standard insertText command (updates ProseMirror state)
    const success = document.execCommand('insertText', false, text);
    if (!success) {
      editor.innerText = text;
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    
    // Trigger input event to guarantee model registers text box contents
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}
