export type Room = {
  room_id: string;
  document_id: string;
  generation: number;
  filename: string;
  field_codes?: boolean;
  last_activity_at: string;
  collaboration_url: string;
};

export type RoomStatus = {
  document: Room | null;
  stale: boolean;
};

export type Job = {
  id: string;
  room_id: string;
  prompt: string;
  selectedText?: string;
  isSuggesting: boolean;
  status: 'queued' | 'running' | 'applying_edit' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  answer?: string;
  error?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  tool: string;
  action?: string;
  status: 'generating' | 'running' | 'completed' | 'failed';
  startedAt: string;
  durationMs?: number;
};

export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  selectedText?: string;
  toolCalls?: ToolCall[];
};
