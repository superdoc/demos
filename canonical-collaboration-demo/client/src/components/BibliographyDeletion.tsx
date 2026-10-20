import { useMemo, type ComponentProps } from 'react';
import { BibliographyDeletion as PortableBibliographyDeletion } from '../reference-integration/components/BibliographyDeletion';
import { createReferenceTransport, referenceContainer } from '../reference-transport';
import type { Room } from '../types';

type Props = Omit<ComponentProps<typeof PortableBibliographyDeletion>, 'transport' | 'documentKey' | 'getContainer'> & { room: Room };
export function BibliographyDeletion({ room, ...props }: Props) {
  const transport = useMemo(() => createReferenceTransport(room), [room.room_id, room.generation]);
  return <PortableBibliographyDeletion {...props} transport={transport} documentKey={`${room.room_id}:${room.generation}`} getContainer={referenceContainer} />;
}
