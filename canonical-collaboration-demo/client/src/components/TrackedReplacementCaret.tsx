import type { ComponentProps } from 'react';
import { TrackedReplacementCaret as PortableTrackedReplacementCaret } from '../reference-integration/components/TrackedReplacementCaret';
import { typingContainer } from '../reference-transport';

export function TrackedReplacementCaret(props: Omit<ComponentProps<typeof PortableTrackedReplacementCaret>, 'getContainer'>) {
  return <PortableTrackedReplacementCaret {...props} getContainer={typingContainer} />;
}
