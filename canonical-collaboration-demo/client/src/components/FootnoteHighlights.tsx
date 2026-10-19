import { useMemo, type ComponentProps } from 'react';
import { FootnoteHighlights as PortableFootnoteHighlights } from '../reference-integration/components/FootnoteHighlights';
import { createReferenceTransport, referenceContainer } from '../reference-transport';
import type { Room } from '../types';

type Props = Omit<ComponentProps<typeof PortableFootnoteHighlights>, 'transport' | 'documentKey' | 'getContainer'> & { room: Room };
export function FootnoteHighlights({ room, ...props }: Props) {
  const transport = useMemo(() => createReferenceTransport(room), [room.room_id, room.generation]);
  return <PortableFootnoteHighlights {...props} transport={transport} documentKey={`${room.room_id}:${room.generation}`} getContainer={referenceContainer} />;
}
