import type { ReactNode } from 'react';
import { DocumentToolbar } from '../../../components/DocumentToolbar';

export function Ribbon({ viewControls }: { viewControls?: ReactNode }) {
  return <DocumentToolbar viewControls={viewControls} />;
}
