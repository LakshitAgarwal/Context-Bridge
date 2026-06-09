import { Message } from './types';

/**
 * Heuristic token estimation (chars / 4)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ChunkInfo {
  chunks: string[];
  totalChunks: number;
  estimatedTokens: number;
}

/**
 * Normalizes message data into a standardized text layout
 */
export function compileMessageToText(msg: Message): string {
  const roleName = msg.role === 'user' ? 'USER' : msg.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
  let text = `[${roleName}]: ${msg.content}`;
  
  if (msg.attachments && msg.attachments.length > 0) {
    text += '\n[Attachments]:';
    msg.attachments.forEach(att => {
      text += `\n- Name: ${att.name} (${att.type})`;
      if (att.content) {
        text += `\n  Content: ${att.content}`;
      }
    });
  }
  return text;
}

/**
 * Slices a conversation into prompt blocks wrapped with system alignment directives
 */
export function prepareChunks(messages: Message[], maxChunkSizeTokens: number = 4000): ChunkInfo {
  // Compile each message into text & estimate its token weight
  const compiledMessages = messages.map(msg => {
    const text = compileMessageToText(msg);
    return {
      text,
      tokens: estimateTokens(text)
    };
  });

  const chunks: string[] = [];
  let currentChunkText: string[] = [];
  let currentChunkTokens = 0;
  let totalEstimatedTokens = 0;

  for (const item of compiledMessages) {
    totalEstimatedTokens += item.tokens;

    // If a single message exceeds the chunk limit, load it as its own standalone chunk
    if (item.tokens > maxChunkSizeTokens) {
      if (currentChunkText.length > 0) {
        chunks.push(currentChunkText.join('\n\n'));
        currentChunkText = [];
        currentChunkTokens = 0;
      }
      chunks.push(item.text);
      continue;
    }

    // Wrap chunk if it exceeds the token limit
    if (currentChunkTokens + item.tokens > maxChunkSizeTokens) {
      chunks.push(currentChunkText.join('\n\n'));
      currentChunkText = [item.text];
      currentChunkTokens = item.tokens;
    } else {
      currentChunkText.push(item.text);
      currentChunkTokens += item.tokens;
    }
  }

  if (currentChunkText.length > 0) {
    chunks.push(currentChunkText.join('\n\n'));
  }

  // Prepend alignment directives to each chunk
  const totalChunks = chunks.length;
  const processedChunks = chunks.map((chunkContent, index) => {
    const chunkNum = index + 1;
    
    if (totalChunks === 1) {
      return `[SYSTEM: CONTEXT RESTORATION]\nBelow is the log of our previous conversation. Ingest this context, summarize the topic, and await my next instruction.\n\n--- CONTEXT START ---\n${chunkContent}\n--- CONTEXT END ---`;
    }
    
    if (chunkNum === 1) {
      return `[SYSTEM: CONTEXT INGESTION - PART 1 OF ${totalChunks}]\nI am restoring a long conversation in chunks. Below is Part 1. Read and store this context, but do NOT reply to the conversation yet. Reply ONLY with the exact phrase: "Awaiting next chunk." to confirm receipt.\n\n--- CONTEXT START ---\n${chunkContent}\n--- CONTEXT END ---`;
    } else if (chunkNum < totalChunks) {
      return `[SYSTEM: CONTEXT INGESTION - PART ${chunkNum} OF ${totalChunks}]\nBelow is Part ${chunkNum} of the conversation context. Append this to the previous parts. Reply ONLY with the exact phrase: "Awaiting next chunk." to confirm receipt.\n\n--- CONTEXT START ---\n${chunkContent}\n--- CONTEXT END ---`;
    } else {
      return `[SYSTEM: CONTEXT INGESTION - PART ${chunkNum} OF ${totalChunks} (FINAL)]\nBelow is the final part of the conversation context. Ingest it, append it to the rest, and reply with: "Context fully restored. I am ready to continue the conversation." followed by a very brief 1-sentence summary of the conversation state.\n\n--- CONTEXT START ---\n${chunkContent}\n--- CONTEXT END ---`;
    }
  });

  return {
    chunks: processedChunks,
    totalChunks,
    estimatedTokens: totalEstimatedTokens
  };
}
