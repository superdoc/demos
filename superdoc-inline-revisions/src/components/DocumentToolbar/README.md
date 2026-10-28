# DocumentToolbar

Copy this entire folder into a React app to use the complete toolbar. Importing
`DocumentToolbar` automatically loads all toolbar CSS, icons, and menus. It has no
dependency on the demo's components, page CSS, document file, or application state.
Dependencies: React, React DOM, and SuperDoc with `superdoc/ui/react` and atomic
mutation-plan support (verified with SuperDoc 2.27.0).

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

This includes the mutation planner, locked-control selection, formatting
shortcuts, and Undo/Redo support. No additional event listeners or formatting
handlers need to be registered in the host app. Clicking a locked control selects
its contents; selecting part of its text keeps formatting limited to that range.

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
Inline formatting and text replacement use the public mutation planner on
`activeEditor.doc`. The table size picker routes `table-insert` to `create.table`.

When selected text intersects content-locked controls, `useSelectionFormatting`
routes inline formatting through the public mutation planner, `doc.mutations.apply`.
For locked controls this runs inside `doc.plan.execute({ atomic: true })`: unlock
the intersecting controls, execute the mutation plan, then restore each original
lock mode.
The plan commits once, rolls back on failure, and adds one Undo entry. Nested
control locks are restored, and neighboring controls outside the selection are
excluded. Review mode tracks the formatting while lock changes remain direct.
The same routing handles subscript/superscript and change case. Paragraph
formatting, lists, and styles use the standard UI commands with locks in place.
Clear formatting resets inline formatting through the atomic route and resets
paragraph properties through their normal Document API operations.

Clicking a locked control selects its contents for formatting; a deliberate text
highlight still applies only to that highlighted range. `FormattingShortcuts`
routes Cmd/Ctrl+B, I, U, Shift+X (strikethrough), Shift+H (highlight), Alt+C
(clear formatting), = (subscript), and Shift+= (superscript) through the same
handler as the toolbar buttons. The shortcut listener is scoped to the editor
and leaves comment inputs and other form controls alone.

The atomic route requires a host supporting atomic plans
(verified on SuperDoc 2.27); an unsupported plan fails without unlocking the
document through a sequence of separate calls.

## Code guide

| File | Responsibility |
| --- | --- |
| `mutationPlanner.ts` | Converts typed text changes into SDK mutation steps and commits unlock → mutate → restore atomically. |
| `contentControlSelection.ts` | Resolves text/SDT selections and finds the controls that intersect the selected range. |
| `useSelectionFormatting.ts` | Routes toolbar and shortcut commands to the shared planner. |
| `FormattingShortcuts.tsx` | Intercepts editor formatting shortcuts in the capture phase and selects clicked locked controls. |
| `DocumentToolbar.tsx` | Automatically mounts the sections and editor interactions, and binds the optional editor instance. |

The planner accepts `SelectionChange` values (`format` or `replaceText`) with a
typed target and payload. It does not accept arbitrary operation names or cast
unknown inputs into formatting operations. Start with `applySelectionChanges`
in `mutationPlanner.ts` to follow the execution path.

The style gallery reads the live document's style catalog and applies styles
through the shared `linked-style` command. Bulk review actions use
`useSuperDocCommand('acceptAllChanges')` / `useSuperDocCommand('rejectAllChanges')`.
They follow the controller's enabled state and stay disabled while a decision is
pending. Viewing mode disables document mutations.

Selection-dependent menus preserve the editor selection. Escape and outside
click dismiss menus; arrow keys navigate menu options.


The font-family menu previews each font name using the SDK's `previewFamily`
(or its font-family value when no preview family is supplied), marks the active
font, and supports arrow keys and typing a name prefix. Font selection executes
the same `font-family` command with the preserved document selection.

Browser coverage lives in `tests/toolbar.spec.ts`; see `tests/README.md` for the
runner and revision fixture. Inline toggles, including subscript/superscript,
read the selected properties through `format.readSelection`. Text-case operations
read the current selection from the Document API rather than relying on a
potentially stale UI snapshot.

`tests/standalone-toolbar.spec.ts` copies this folder into a temporary app and
uses the example above. It verifies toolbar formatting, keyboard shortcuts,
Undo, and tracked-change rejection on a locked control without demo components,
demo styles, an application-owned UI provider, or custom event wiring.
