import { useMemo, type ComponentProps } from 'react';
import { CitationDeletion as PortableCitationDeletion } from '../reference-integration/components/CitationDeletion';
import { createReferenceTransport, referenceContainer } from '../reference-transport';
import type { Room } from '../types';

type Props = Omit<ComponentProps<typeof PortableCitationDeletion>, 'transport' | 'documentKey' | 'getContainer'> & { room: Room };
export function CitationDeletion({ room, ...props }: Props) {
  const transport = useMemo(() => createReferenceTransport(room), [room.room_id, room.generation]);
  return <PortableCitationDeletion {...props} transport={transport} documentKey={`${room.room_id}:${room.generation}`} getContainer={referenceContainer} />;
}
