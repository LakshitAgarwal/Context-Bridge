import { Message } from './types';

/**
 * Heuristic token estimation (chars / 4)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function compileHistoryToMarkdown(messages: Message[]): string {
  let md = '';
  
  messages.forEach((msg, idx) => {
    const roleName = msg.role === 'user' ? 'USER' : msg.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
    md += `### [${roleName} - Message ${idx + 1}]\n\n${msg.content}\n\n`;
    
    if (msg.attachments && msg.attachments.length > 0) {
      md += `*Attachments*:\n`;
      msg.attachments.forEach(att => {
        md += `- **Name**: ${att.name} (${att.type})\n`;
        if (att.content) {
          md += `  Content:\n\`\`\`\n${att.content}\n\`\`\`\n`;
        }
      });
      md += `\n`;
    }
    md += `--------------------------------------------------\n\n`;
  });
  
  return md.trim();
}

