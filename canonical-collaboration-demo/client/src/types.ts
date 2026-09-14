export type Room = {
  room_id: string;
  document_id: string;
  generation: number;
  filename: string;
  last_activity_at: string;
  collaboration_url: string;
};

export type Job = {
  id: string;
  room_id: string;
  prompt: string;
  isSuggesting: boolean;
  status: 'queued' | 'running' | 'applying_edit' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  answer?: string;
  error?: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};
