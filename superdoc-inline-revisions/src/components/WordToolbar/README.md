# WordToolbar

Reusable compact Word-style toolbar for a SuperDoc editor. It requires the
`SuperDocUIProvider` already used by this demo. The component owns its icons,
menus, selection preservation, and formatting commands. It
has no dependency on the demo or `StyleGallery`.

```tsx
import { WordToolbar } from './components/WordToolbar/WordToolbar';

<WordToolbar />
```

Compose it alongside a separate style gallery, as `Ribbon.tsx` does. Disable
the built-in SuperDoc toolbar with `ui: { toolbar: false }` to avoid duplicate
controls. The optional `className` prop lets other demos position the component.

Connected actions: font family and size,
grow/shrink font, change case, clear formatting, bold, italic, underline,
strikethrough, subscript/superscript, font/highlight colors, bullet and numbering
presets, indentation, alignment, line spacing, formatting marks, and table insertion.

The bullet, numbering, and multilevel menus reproduce the reference libraries.
The following visible controls intentionally perform no document mutation pending
clarification (also exported as `WORD_TOOLBAR_PLACEHOLDERS`):

- Multilevel list preset tiles (the None tile removes list formatting)
- Define New Multilevel List
- Define New List Style

Core formatting follows the editor's Reviewing/Editing/Viewing mode. Selection
formatting needs a suitable selection. Menus preserve the document selection,
close on outside click or Escape, and support arrow-key navigation.

## Custom UI and Document API integration

`main.tsx` wraps the demo in `SuperDocUIProvider`. The editor's `onReady`
callback binds the instance with `useSetSuperDoc`, so `useSuperDocUI`,
`useSuperDocToolbar`, and the font option hooks all share the live document's
own UI controller.

Built-in formatting runs through `ui.commands.executeAsync`. Extra actions use
public `activeEditor.doc` operations: `format.apply` and `invoke` for text replacement.
They preserve the selected target and use tracked mutations in Reviewing mode.
`StyleGallery` independently applies styles through the same UI controller.

The Insert Table dropdown provides an 8-column by 6-row size picker. Choosing a
cell executes `ui.commands.executeAsync('table-insert', { rows, columns })`,
which routes to `create.table` and respects the current document mode. The
saved caret/range is restored before insertion.
