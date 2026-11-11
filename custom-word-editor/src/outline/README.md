# Outline generation and rendering

Generation lives here and has no React dependency:

- `types.ts`: plain `OutlineSkeleton` data and mode names.
- `generate-outline.ts`: native heading reads, custom outline reads, and hierarchy construction.
- `custom-outline.ts`: the original HTML projection title-detection rules.
- `navigate-outline.ts`: optional public viewport navigation, separate from generation.

```ts
import { generateOutline } from './generate-outline';

const { entries, skeleton } = await generateOutline(doc, 'headings');
// Use 'custom' for native headings plus projectHtml title detection.
```

The skeleton is plain, serializable data. Document addresses stay in `entries`;
the renderer does not receive or interpret them:

```ts
const skeleton = [
  {
    id: 'overview',
    text: 'Overview',
    children: [
      { id: 'goals', text: 'Goals and outcomes', children: [] },
    ],
  },
];
```

```tsx
import OutlineNavigation from '../components/DocumentOutline/OutlineNavigation';

<OutlineNavigation
  skeleton={skeleton}
  activeId={activeId}
  onNavigate={(id) => {
    const entry = entries.find((item) => item.id === id);
    if (entry) void revealOutlineEntry(doc, ui, entry, () => true);
  }}
/>
```

Import `revealOutlineEntry` from `./navigate-outline` when navigation is needed.
A consumer can also supply a completely different `onNavigate` callback.
The renderer reads no document state and imports its own stylesheet.

The demo's `use-outline.ts` hook handles subscriptions, debouncing, cancellation,
and file replacement. It calls `generateOutline` and publishes entries and their
matching skeleton together. `DocumentOutlinePanel.tsx` supplies that skeleton to
the renderer and resolves clicked IDs back to document entries for navigation.
