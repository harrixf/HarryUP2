export interface TranscriptSegment {
  id: string;
  speaker: string;
  startTime: string; // Format: "MM:SS" or seconds
  text: string;
}

export type Language = 'es' | 'eu';

export enum EditMode {
  RAW = 'RAW',
  CLEANED = 'CLEANED', // Removed fillers
  JOURNALISTIC = 'JOURNALISTIC' // Journalistic style
}

export interface ProcessingState {
  status: 'idle' | 'uploading' | 'transcribing' | 'refining' | 'completed' | 'error';
  message?: string;
}

export interface StoredSession {
  id: string;
  name: string; // Filename
  date: number; // Timestamp
  segments: TranscriptSegment[];
  language: Language;
  editMode: EditMode;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
}