
export enum ChatStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR',
}

export interface TranscriptionEntry {
  speaker: 'user' | 'bot';
  text: string;
  isFinal: boolean;
}
