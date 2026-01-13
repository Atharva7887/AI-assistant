export interface TranscriptItem {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  isPartial?: boolean;
}

export interface SummaryResult {
  summary: string;
  actionItems: string[];
  sentiment: string;
}

export enum AppState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  SUMMARIZING = 'SUMMARIZING',
  SUMMARY_VIEW = 'SUMMARY_VIEW',
  ERROR = 'ERROR'
}

export type Language = 'English' | 'Hindi' | 'Marathi';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  myPhoneNumber: string; // The Twilio number (+12054420312)
  verifiedCallerId?: string; // Your personal phone number to connect the call to first
}

export interface BusinessConfig {
  businessName: string;
  role: string;
  context: string;
  language: Language;
  voiceName: string;
  twilio: TwilioConfig;
}