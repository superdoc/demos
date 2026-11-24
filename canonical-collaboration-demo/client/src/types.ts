export type AgentPresence = { agents: number; name: string };

export type Room = {
  room_id: string;
  document_id: string;
  generation: number;
  filename: string;
  field_codes?: boolean;
  private_agent_chats?: boolean;
  agent_model?: string;
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
  attachmentPreview?: AttachmentPreview;
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
  attachmentPreview?: AttachmentPreview;
};


export type AttachmentPreview = { name: string; kind: 'image' | 'file'; thumbnail?: string };
export type PromptAttachment = AttachmentPreview & { base64: string };
export type PromptCursor = { blockId: string; offset: number; paragraph: string };
export type PromptDocumentTarget = { id: string; generation: number; cursor?: PromptCursor };
