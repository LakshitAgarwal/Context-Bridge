import { Message } from '../types';

export interface SourceAdapter {
  platformId: string;
  detect(url: string): boolean;
  parseDOM(): Promise<Message[]>;
  normalizeNetworkResponse(url: string, payload: any): Message[] | null;
}

export interface TargetAdapter {
  platformId: string;
  detect(url: string): boolean;
  injectPrompt(text: string): Promise<boolean>;
  isReady(): Promise<boolean>;
}
