import type { SuperDoc } from 'superdoc';
import type { BrowserDocumentApi } from 'superdoc/ui';

export type DocumentMode = 'suggesting' | 'editing' | 'viewing';
export type ContainerResolver = (superdoc: SuperDoc) => HTMLElement | null | undefined;
type Citation = Awaited<ReturnType<BrowserDocumentApi['citations']['list']>>['items'][number];

// Bind these callbacks to your authenticated document transport, not a global room.
export type ReferenceTransport = {
  getDocument: (fieldCodes: boolean) => Promise<Blob>;
  getRevision: () => Promise<string>;
  removeCitation: (input: { target: Citation['address']; instruction: string; displayText: string;
    changeMode: 'direct' | 'tracked'; expectedRevision: string }) => Promise<{ success: boolean }>;
  removeEmptyBibliography: (blockId: string, expectedRevision: string) => Promise<{
    success: boolean; removed: boolean; caret?: { blockId: string; offset: number };
  }>;
};
