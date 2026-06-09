export interface Attachment {
  name: string;
  type: string;
  content?: string;
}

export interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  attachments?: Attachment[];
}

export interface ProjectContext {
  id: string; // Typically matches the source conversation UUID
  title: string;
  sourcePlatform: string; // e.g. "claude"
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  metadata?: Record<string, any>;
}
