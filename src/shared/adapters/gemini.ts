import { SourceAdapter } from './base';
import { Message } from '../types';

export class GeminiSourceAdapter implements SourceAdapter {
  platformId = 'gemini';

  detect(url: string): boolean {
    return url.includes('gemini.google.com');
  }

  // Gemini's batchexecute network responses are obfuscated array structures that
  // change frequently. We intentionally bypass network interception and rely
  // entirely on DOM scraping for this platform.
  normalizeNetworkResponse(_url: string, _payload: any): Message[] | null {
    return null;
  }

  async parseDOM(): Promise<Message[]> {
    const parsed: Message[] = [];
    
    // Grab all standard Gemini message container tags/classes
    const nodes = document.querySelectorAll(
      'user-query, model-response, message-content, .user-query, .model-response'
    );
    
    nodes.forEach(node => {
      const tagName = node.tagName.toLowerCase();
      const className = node.className.toLowerCase();
      
      let role: 'user' | 'assistant' | null = null;
      if (tagName === 'user-query' || className.includes('user-query')) {
        role = 'user';
      } else if (tagName === 'model-response' || tagName === 'message-content' || className.includes('model-response') || className.includes('message-content')) {
        role = 'assistant';
      }
      
      if (!role) return;
      
      let content = node.textContent?.trim() || '';
      if (!content) return;

      // ── Clean up hidden accessibility prefixes ──
      // Gemini injects invisible labels for screen readers. We strip them.
      if (role === 'user' && content.startsWith('You said')) {
        content = content.replace(/^You said\s*/i, '');
      } else if (role === 'assistant' && content.startsWith('Gemini said')) {
        content = content.replace(/^Gemini said\s*/i, '');
      }

      content = content.trim();
      if (!content) return;

      parsed.push({ role, content });
    });

    return this.deduplicateMessages(parsed);
  }

  // Gemini renders duplicate elements (one for accessibility, one for display).
  // We filter out identical or subset text strings.
  private deduplicateMessages(messages: Message[]): Message[] {
    if (messages.length <= 1) return messages;

    const cleanMessages: Message[] = [];
    let currentGroup: Message[] = [];

    for (const msg of messages) {
      if (currentGroup.length === 0 || currentGroup[0].role === msg.role) {
        currentGroup.push(msg);
      } else {
        cleanMessages.push(...this.filterConsecutiveGroup(currentGroup));
        currentGroup = [msg];
      }
    }
    if (currentGroup.length > 0) {
      cleanMessages.push(...this.filterConsecutiveGroup(currentGroup));
    }

    return cleanMessages;
  }

  private filterConsecutiveGroup(group: Message[]): Message[] {
    if (group.length <= 1) return group;

    // Sort by content length descending
    const sorted = [...group].map((msg, index) => ({ msg, index, text: msg.content }));
    sorted.sort((a, b) => b.text.length - a.text.length);

    const toKeep = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      const candidate = sorted[i];
      let isSubset = false;

      for (const keptIndex of toKeep) {
        const kept = group[keptIndex];
        // If the candidate's text is a substring of an already kept (longer) message
        if (kept.content.includes(candidate.text)) {
          isSubset = true;
          break;
        }
      }

      if (!isSubset && candidate.text.length > 0) {
        toKeep.add(candidate.index);
      }
    }

    // Return the preserved messages in their original chronological order
    return group.filter((_, index) => toKeep.has(index));
  }
}
