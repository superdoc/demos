# DocumentToolbar

Copy this entire folder into a React app to use the complete toolbar. Importing
`DocumentToolbar` automatically loads all toolbar CSS, icons, and menus. It has no
dependency on the demo's components, page CSS, document file, or application state.
Dependencies: React, React DOM, and SuperDoc with `superdoc/ui/react` support
(tested with SuperDoc 2.24.0).

The single public component composes three sections:

```text
DocumentToolbar
├── FormattingControls       text, fonts, paragraph formatting, lists, tables
├── StyleGallery             document-derived style previews and headings
└── TrackedChangesControls   accept all / reject all
```

## Use with an editor instance

```tsx
import { DocumentToolbar } from './components/DocumentToolbar';

// `editor` is your SuperDoc instance; null while it is opening.
<DocumentToolbar superdoc={editor} />
```

The `superdoc` prop connects an internal `SuperDocUIProvider` to the instance's
existing UI controller. The toolbar does not create or destroy an editor. Passing
`null` clears the connection and renders disabled controls. Replacing the instance
rebinds the toolbar to the new document.

Create the editor with `ui: { toolbar: false }` so it does not display a second
vendor toolbar. Load `superdoc/style.css` for the editor itself; the custom
toolbar's styles are imported automatically.

[examples/EditorWithToolbar.tsx](./examples/EditorWithToolbar.tsx) is a complete,
type-checked example that creates the editor, connects the toolbar in `onReady`,
and destroys the editor on unmount:

```tsx
import { EditorWithToolbar } from './components/DocumentToolbar/examples/EditorWithToolbar';

<EditorWithToolbar documentUrl="/my-document.docx" />
```

## Use an existing SuperDoc UI provider

If your app already uses the React custom UI hooks, omit the `superdoc` prop:

```tsx
import { SuperDocUIProvider } from 'superdoc/ui/react';
import { DocumentToolbar } from './components/DocumentToolbar';

<SuperDocUIProvider>
  <DocumentToolbar />
  <YourEditor />
</SuperDocUIProvider>
```

Inside `YourEditor`, bind the ready instance using `useSetSuperDoc`:

```tsx
import { useSetSuperDoc } from 'superdoc/ui/react';

const setSuperDoc = useSetSuperDoc();
// In your existing editor configuration:
onReady: ({ superdoc }) => setSuperDoc(superdoc)
```

The inline revisions demo uses this approach so its toolbar, comments, and editor
share one instance-owned controller. Do not add a second provider around each
section: all three sections share the toolbar's controller.

## Layout

```tsx
<DocumentToolbar
  superdoc={editor}
  className="my-toolbar"
  style={{ width: '100%', maxWidth: 1200 }}
  aria-label="Contract editing toolbar"
/>
```

The toolbar defaults to a centered row, with the style gallery filling the
remaining space. In narrow containers its sections wrap and the formatting
controls can scroll horizontally. Menus are portaled to `document.body` to avoid
clipping. Optional CSS variables are `--document-toolbar-max-width` (default 1200px)
and `--document-toolbar-background` (default #f8f8f8).

`FormattingControls`, `StyleGallery`, and `TrackedChangesControls` are also named
exports for apps that need a different composition under an existing provider.

## Actions and API wiring

Formatting includes font family/size, grow/shrink font, change case, clear
formatting, bold, italic, underline, strikethrough, subscript/superscript, colors,
bullet/numbering presets, indentation, alignment, spacing, formatting marks, and
table insertion. Built-in operations execute through `ui.commands.executeAsync`.
Extra inline formatting and text replacement use the public `activeEditor.doc`
facade. The table size picker routes `table-insert` to `create.table`.

The style gallery reads the live document's style catalog and applies styles
through the shared `linked-style` command. Bulk review actions use
`useSuperDocCommand('acceptAllChanges')` / `useSuperDocCommand('rejectAllChanges')`.
They follow the controller's enabled state and stay disabled while a decision is
pending. Viewing mode disables document mutations.

Selection-dependent menus preserve the editor selection. Escape and outside
click dismiss menus; arrow keys navigate menu options.

The remaining intentional no-ops are highlighted pink and exported as
`DOCUMENT_TOOLBAR_PLACEHOLDERS`: multilevel preset tiles, Define New Multilevel List,
and Define New List Style. The multilevel menu's None tile removes list formatting.
