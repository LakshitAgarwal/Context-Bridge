import { SourceAdapter } from './base';
import { Message } from '../types';

export class ChatGPTSourceAdapter implements SourceAdapter {
  platformId = 'chatgpt';

  detect(url: string): boolean {
    return url.includes('chatgpt.com');
  }

  // DOM fallback for ChatGPT (used if network interception misses)
  async parseDOM(): Promise<Message[]> {
    const parsed: Message[] = [];

    // ChatGPT renders messages in article elements with data-message-author-role
    const messageNodes = document.querySelectorAll<HTMLElement>('[data-message-author-role]');

    messageNodes.forEach(node => {
      const roleAttr = node.getAttribute('data-message-author-role');
      const role: 'user' | 'assistant' | null =
        roleAttr === 'user' ? 'user' :
        roleAttr === 'assistant' ? 'assistant' : null;

      if (!role) return;

      const content = node.textContent?.trim() || '';
      if (!content) return;

      const last = parsed[parsed.length - 1];
      if (last && last.role === role && last.content === content) return;

      parsed.push({ role, content });
    });

    return parsed;
  }

  /**
   * Parses ChatGPT's conversation mapping tree into a flat ordered message list.
   * The tree is walked backwards from `current_node` to the root via `parent` links.
   *
   * Expected payload shape (from /backend-api/conversation/{id}):
   * {
   *   title: string,
   *   mapping: { [nodeId]: { message: {...}, parent: string, children: string[] } },
   *   current_node: string
   * }
   */
  normalizeNetworkResponse(_url: string, payload: any): Message[] | null {
    // Guard: skip metadata/status responses that match the URL but lack conversation data
    if (!payload || !payload.mapping || !payload.current_node) return null;

    const messages: Message[] = [];
    const visited = new Set<string>();
    let nodeId: string = payload.current_node;

    // Walk from current leaf node up to root via parent links
    while (nodeId && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = payload.mapping[nodeId];
      if (!node) break;

      const msg = node.message;
      if (msg && msg.content && msg.author) {
        const authorRole: string = msg.author.role;

        // Only capture user and assistant turns — skip system/tool/hidden nodes
        if (authorRole === 'user' || authorRole === 'assistant') {
          // Parts can be strings or objects (e.g. image references)
          const parts: any[] = msg.content.parts || [];
          const text = parts
            .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
            .join('');

          if (text.trim().length > 0) {
            messages.unshift({
              role: authorRole as 'user' | 'assistant',
              content: text,
              timestamp: msg.create_time ? Math.floor(msg.create_time * 1000) : undefined,
            });
          }
        }
      }

      nodeId = node.parent;
    }

    return messages.length > 0 ? messages : null;
  }
}
