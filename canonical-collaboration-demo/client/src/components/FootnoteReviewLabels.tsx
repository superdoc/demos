import type { ComponentProps } from 'react';
import { FootnoteReviewLabels as PortableFootnoteReviewLabels } from '../reference-integration/components/FootnoteReviewLabels';
import { referenceContainer } from '../reference-transport';

export function FootnoteReviewLabels(props: Omit<ComponentProps<typeof PortableFootnoteReviewLabels>, 'getContainer'>) {
  return <PortableFootnoteReviewLabels {...props} getContainer={referenceContainer} />;
}
