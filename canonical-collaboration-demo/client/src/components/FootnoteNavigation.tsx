import { useMemo, type ComponentProps } from 'react';
import { FootnoteNavigation as PortableFootnoteNavigation } from '../reference-integration/components/FootnoteNavigation';
import { createReferenceTransport, referenceContainer } from '../reference-transport';
import type { Room } from '../types';

type Props = Omit<ComponentProps<typeof PortableFootnoteNavigation>, 'transport' | 'documentKey' | 'getContainer'> & { room?: Room };
export function FootnoteNavigation({ room, ...props }: Props) {
  const transport = useMemo(() => room ? createReferenceTransport(room) : undefined, [room?.room_id, room?.generation]);
  return <PortableFootnoteNavigation {...props} transport={transport} documentKey={room ? `${room.room_id}:${room.generation}` : undefined} getContainer={referenceContainer} />;
}
