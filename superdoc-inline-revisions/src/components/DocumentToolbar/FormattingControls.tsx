import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SelectionCapture, SelectionTarget } from 'superdoc/ui';
import { useSuperDocFontOptions, useSuperDocFontSizeOptions, useSuperDocHost, useSuperDocToolbar, useSuperDocUI } from 'superdoc/ui/react';
import { ToolbarIcon } from './ToolbarIcon';
import type { IconName } from './ToolbarIcon';
import { useSelectionFormatting } from './useSelectionFormatting';
import './FormattingControls.css';

type MenuId = 'fonts' | 'table' | 'underline' | 'case' | 'highlight' | 'color' | 'bullets' | 'numbers' | 'spacing';
type OpenMenu = { id: MenuId; left: number; top: number; trigger: HTMLButtonElement };
type ToolOptions = (
  | { command: string; menu?: never; action?: never }
  | { command?: never; menu: MenuId; action?: never }
  | { command?: never; menu?: never; action: () => void }
) & { payload?: unknown; active?: boolean; disabled?: boolean; className?: string };

const COLORS = ['#000000', '#ffffff', '#e50022', '#ff9900', '#fff200', '#70ad47', '#00b0f0', '#0070c0', '#7030a0', '#666666'];
const NUMBERS = [
  { label: 'Decimal', preset: 'decimal', markers: ['1.', '2.', '3.'] },
  { label: 'Decimal parentheses', preset: 'decimalParenthesis', markers: ['1)', '2)', '3)'] },
  { label: 'Upper Roman', preset: 'upperRoman', markers: ['I.', 'II.', 'III.'] },
  { label: 'Upper letters', preset: 'upperLetter', markers: ['A.', 'B.', 'C.'] },
  { label: 'Lower letters parentheses', preset: 'lowerLetterParenthesis', markers: ['a)', 'b)', 'c)'] },
  { label: 'Lower letters', preset: 'lowerLetter', markers: ['a.', 'b.', 'c.'] },
  { label: 'Lower Roman', preset: 'lowerRoman', markers: ['i.', 'ii.', 'iii.'] },
];
function ListPreview({ markers }: { markers: string[] }) {
  return <span className="document-toolbar-list-preview" aria-hidden="true">{markers.map((marker, index) => <span key={index}><span>{marker}</span><i /></span>)}</span>;
}

/** Text and paragraph controls sharing the parent toolbar’s SuperDoc UI controller. */
export function FormattingControls({ className = '' }: { className?: string }) {
  const ui = useSuperDocUI();
  const host = useSuperDocHost();
  const toolbar = useSuperDocToolbar();
  const formatting = useSelectionFormatting();
  const fonts = useSuperDocFontOptions();
  const sizes = useSuperDocFontSizeOptions();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [status, setStatus] = useState('');
  const [formattingPending, setFormattingPending] = useState(false);
  const [tableSize, setTableSize] = useState({ rows: 1, columns: 1 });
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<SelectionCapture | null>(null);
  const tableTargetRef = useRef<SelectionTarget | null>(null);
  const state = (command: string) => toolbar.commands[command];
  const readOnly = formatting.readOnly || formatting.pending;
  const font = String(state('font-family')?.value ?? 'Calibri');
  const size = String(state('font-size')?.value ?? '11');
  const fontOptions = fonts.some((option) => option.value === font) ? fonts : [{ label: font, value: font, previewFamily: font }, ...fonts];
  const fontLabel = fontOptions.find((option) => option.value === font)?.label ?? font;
  const fontSearchRef = useRef({ text: '', time: 0 });

  const preserve = () => { captureRef.current = ui?.selection.capture() ?? null; };
  const closeMenu = (focus = false) => {
    if (focus) menu?.trigger.focus();
    setMenu(null);
    captureRef.current = null;
    tableTargetRef.current = null;
  };
  const restore = () => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) ui?.selection.restore(capture);
    return capture;
  };
  const reportError = (message: string) => setStatus(message);
  const run = async (command: string, payload?: unknown) => {
    restore();
    if (command === 'table-insert' && tableTargetRef.current) ui?.selection.apply(tableTargetRef.current);
    closeMenu();
    setStatus('');
    try {
      await formatting.execute(command, payload);
    } catch { reportError('The formatting could not be applied to this selection.'); }
  };
  const openMenu = (id: MenuId, trigger: HTMLButtonElement) => {
    if (menu?.id === id) return closeMenu();
    preserve();
    fontSearchRef.current = { text: '', time: 0 };
    tableTargetRef.current = null;
    if (id === 'table') {
      setTableSize({ rows: 1, columns: 1 });
      const selection = ui?.selection.getSnapshot();
      const target = selection?.target;
      tableTargetRef.current = selection?.selectionTarget ?? (target ? {
        kind: 'selection',
        start: { kind: 'text', blockId: target.segments[0].blockId, offset: target.segments[0].range.start, ...(target.story ? { story: target.story } : {}) },
        end: { kind: 'text', blockId: target.segments[target.segments.length - 1].blockId, offset: target.segments[target.segments.length - 1].range.end, ...(target.story ? { story: target.story } : {}) },
        ...(target.story ? { story: target.story } : {}),
        ...(target.coordinateSpace ? { coordinateSpace: target.coordinateSpace } : {}),
      } : null);
    }
    const bounds = trigger.getBoundingClientRect();
    setMenu({ id, left: Math.max(8, Math.min(bounds.left, window.innerWidth - 278)), top: bounds.bottom + 3, trigger });
  };

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !rootRef.current?.contains(event.target as Node)) { setMenu(null); captureRef.current = null; tableTargetRef.current = null; }
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
      captureRef.current = null;
      tableTargetRef.current = null;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); menu.trigger.focus(); setMenu(null); captureRef.current = null; tableTargetRef.current = null; }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    const initialFocus = menuRef.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]') ?? menuRef.current?.querySelector<HTMLButtonElement>('button');
    initialFocus?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

  const verticalAlign = async (value: 'subscript' | 'superscript') => {
    if (readOnly || formattingPending) return;
    restore();
    const doc = host?.activeEditor?.doc;
    if (!doc?.selection?.current || !doc.format?.apply) return;
    setFormattingPending(true);
    try {
      await formatting.execute(value);
    } catch { reportError('This formatting could not be applied.'); }
    finally { setFormattingPending(false); }
  };
  const changeCase = async (transform: (text: string) => string) => {
    if (readOnly || formattingPending) return;
    restore();
    closeMenu();
    const doc = host?.activeEditor?.doc;
    if (!doc?.selection?.current || !doc.invoke) return;
    setFormattingPending(true);
    try {
      const selection = await formatting.getSelection();
      if (selection.empty || !selection.selectionTarget || selection.text === undefined) return;
      const text = transform(selection.text);
      if (text === selection.text) return;
      await formatting.applyChanges(selection, [{ kind: 'replaceText', target: selection.selectionTarget, text }]);
    } catch { reportError('The case could not be changed for this selection.'); }
    finally { setFormattingPending(false); }
  };
  const button = (label: string, icon: IconName, options: ToolOptions) => (
    <button type="button" className={`document-toolbar-tool ${options.className ?? ''}${(options.active ?? (options.command ? state(options.command)?.active : false)) ? ' is-active' : ''}`} aria-label={label} title={label}
      disabled={formatting.pending || (options.disabled ?? (options.command ? !formatting.canExecute(options.command) : readOnly))}
      aria-pressed={options.command || options.active !== undefined ? options.active ?? state(options.command ?? '')?.active ?? false : undefined}
      aria-haspopup={options.menu ? 'menu' : undefined} aria-expanded={options.menu ? menu?.id === options.menu : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => options.menu ? openMenu(options.menu, event.currentTarget) : options.action ? options.action() : options.command ? void run(options.command, options.payload) : undefined}>
      <ToolbarIcon name={icon} />{options.menu ? <span className="document-toolbar-caret" aria-hidden="true" /> : null}
    </button>
  );
  const split = (label: string, icon: IconName, command: string, id: MenuId, payload?: unknown) => (
    <span className="document-toolbar-split">{button(label, icon, { command, payload })}<button type="button" className="document-toolbar-tool document-toolbar-menu-arrow" aria-label={`${label} options`} title={`${label} options`} aria-haspopup="menu" aria-expanded={menu?.id === id} disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={(event) => openMenu(id, event.currentTarget)}><span className="document-toolbar-caret" aria-hidden="true" /></button></span>
  );
  const item = (label: string, action: () => void, children?: ReactNode) => <button type="button" role="menuitem" className={children ? 'document-toolbar-gallery-tile' : 'document-toolbar-menu-item'} aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={action}>{children ?? label}</button>;
  const none = () => {
    // Both libraries' None tile removes either kind of list from the selected paragraphs.
    if (state('bullet-list')?.active) void run('bullet-list');
    else if (state('numbered-list')?.active) void run('numbered-list');
    else { restore(); closeMenu(); }
  };
  let menuContent: ReactNode;
  switch (menu?.id) {
    case 'fonts': menuContent = <>
      <div className="document-toolbar-menu-heading">Fonts</div>
      {fontOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === font} aria-label={option.label} title={option.label} data-font-name={option.label} className="document-toolbar-menu-item document-toolbar-font-option" style={{ fontFamily: option.previewFamily ?? option.value }} onMouseDown={(event) => event.preventDefault()} onClick={() => void run('font-family', option.value)}>
        <span className="document-toolbar-font-check" aria-hidden="true">{option.value === font ? '✓' : ''}</span>
        <span>{option.label}</span>
      </button>)}
    </>; break;
    case 'table': menuContent = <>
      <div className="document-toolbar-menu-heading">Insert Table</div>
      <div className="document-toolbar-table-size">{tableSize.columns} × {tableSize.rows} Table</div>
      <div className="document-toolbar-table-grid" onPointerLeave={() => setTableSize({ rows: 1, columns: 1 })}>
        {Array.from({ length: 48 }, (_, index) => {
          const rows = Math.floor(index / 8) + 1;
          const columns = index % 8 + 1;
          return <button key={index} type="button" role="menuitem" aria-label={`Insert ${columns} column by ${rows} row table`} title={`${columns} × ${rows} Table`} className={rows <= tableSize.rows && columns <= tableSize.columns ? 'is-selected' : ''} onPointerEnter={() => setTableSize({ rows, columns })} onFocus={() => setTableSize({ rows, columns })} onMouseDown={(event) => event.preventDefault()} onClick={() => void run('table-insert', { rows, columns })} />;
        })}
      </div>
    </>; break;
    case 'bullets': menuContent = <><div className="document-toolbar-menu-heading">Bullet Library</div><div className="document-toolbar-bullet-grid">{item('No bullets', () => none(), <span>None</span>)}{[['Disc', 'disc', '●'], ['Circle', 'circle', '○'], ['Square', 'square', '▪']].map(([label, preset, glyph]) => <span key={preset}>{item(label, () => void run('bullet-list', { preset, behavior: 'toggleStyle' }), <span className="document-toolbar-bullet-glyph">{glyph}</span>)}</span>)}</div></>; break;
    case 'numbers': menuContent = <><div className="document-toolbar-menu-heading">Numbering Library</div><div className="document-toolbar-number-grid">{item('No numbering', () => none(), <span>None</span>)}{NUMBERS.map(({ label, preset, markers }) => <span key={preset}>{item(label, () => void run('numbered-list', { preset, behavior: 'toggleStyle' }), <ListPreview markers={markers} />)}</span>)}</div></>; break;
    case 'spacing': menuContent = <>{[1, 1.15, 1.5, 2, 2.5, 3].map((value) => <span key={value}>{item(String(value), () => void run('line-height', value))}</span>)}</>; break;
    case 'color': case 'highlight': menuContent = <><div className="document-toolbar-menu-heading">{menu.id === 'color' ? 'Font Color' : 'Text Highlight Color'}</div><div className="document-toolbar-color-grid">{COLORS.map((color) => <button type="button" role="menuitem" key={color} aria-label={`Apply ${color}`} title={color} style={{ backgroundColor: color }} onMouseDown={(event) => event.preventDefault()} onClick={() => void run(menu.id === 'color' ? 'text-color' : 'highlight-color', color)} />)}</div>{menu.id === 'highlight' ? item('No Color', () => void run('highlight-color', 'none')) : item('Automatic', () => void run('text-color', '#000000'))}</>; break;
    case 'case': menuContent = <>{item('Sentence case.', () => void changeCase((text) => text.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (letter) => letter.toUpperCase())))}{item('lowercase', () => void changeCase((text) => text.toLowerCase()))}{item('UPPERCASE', () => void changeCase((text) => text.toUpperCase()))}{item('Title Case', () => void changeCase((text) => text.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())))}{item('tOGGLE cASE', () => void changeCase((text) => [...text].map((letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()).join('')))}</>; break;
    case 'underline': menuContent = <>{item('Underline', () => void run('underline'))}</>; break;
  }

  return <>
    <div ref={rootRef} className={`document-toolbar-formatting-controls ${className}`} role="group" aria-label="Text options and formatting">
      <div className="document-toolbar-font-group" role="group" aria-label="Font">
        <div className="document-toolbar-tool-row">
          <button type="button" aria-label="Font family" title={fontLabel} className="document-toolbar-font-select" disabled={readOnly} aria-haspopup="menu" aria-expanded={menu?.id === 'fonts'} onMouseDown={(event) => event.preventDefault()} onClick={(event) => openMenu('fonts', event.currentTarget)} onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openMenu('fonts', event.currentTarget);
            }
          }}>
            <span className="document-toolbar-font-value">{fontLabel}</span>
            <span className="document-toolbar-caret" aria-hidden="true" />
          </button>
          <select aria-label="Font size" className="document-toolbar-size-select" value={size} disabled={readOnly} onPointerDown={preserve} onChange={(event) => void run('font-size', Number(event.target.value))}>
            {!sizes.some((option) => option.value === size) ? <option value={size}>{size}</option> : null}
            {sizes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {button('Grow Font', 'grow', { command: 'font-size', payload: Math.min(1638, Number(size) + 1) })}
          {button('Shrink Font', 'shrink', { command: 'font-size', payload: Math.max(1, Number(size) - 1) })}
          <span className="document-toolbar-divider" />
          {button('Change Case', 'case', { menu: 'case' })}
          <span className="document-toolbar-divider" />
          {button('Clear All Formatting', 'clear', { command: 'clear-formatting' })}
        </div>
        <div className="document-toolbar-tool-row document-toolbar-font-bottom">
          {button('Bold', 'bold', { command: 'bold' })}{button('Italic', 'italic', { command: 'italic' })}
          {split('Underline', 'underline', 'underline', 'underline')}
          {button('Strikethrough', 'strike', { command: 'strikethrough' })}
          {button('Subscript', 'subscript', { action: () => void verticalAlign('subscript'), disabled: readOnly || formattingPending })}
          {button('Superscript', 'superscript', { action: () => void verticalAlign('superscript'), disabled: readOnly || formattingPending })}
          <span className="document-toolbar-divider" />
          {split('Text Highlight Color', 'highlight', 'highlight-color', 'highlight', '#fff200')}
          {split('Font Color', 'color', 'text-color', 'color', '#e50022')}
        </div>
      </div>
      <div className="document-toolbar-paragraph-group" role="group" aria-label="Paragraph">
        <div className="document-toolbar-tool-row">
          {split('Bullets', 'bullets', 'bullet-list', 'bullets')}
          {split('Numbering', 'numbers', 'numbered-list', 'numbers')}
          <span className="document-toolbar-divider" />
          {button('Decrease Indent', 'outdent', { command: 'indent-decrease' })}
          {button('Increase Indent', 'indent', { command: 'indent-increase' })}
          <span className="document-toolbar-divider" />
          {button('Show/Hide Formatting Marks', 'marks', { command: 'formatting-marks' })}
        </div>
        <div className="document-toolbar-tool-row document-toolbar-paragraph-bottom">
          {(['left', 'center', 'right', 'justify'] as const).map((value) => <span key={value}>{button(value === 'justify' ? 'Justify' : `Align ${value}`, value, { command: 'text-align', payload: value, active: state('text-align')?.value === value })}</span>)}
          <span className="document-toolbar-divider" />
          {button('Line and Paragraph Spacing', 'spacing', { menu: 'spacing' })}
          <span className="document-toolbar-divider" />
          {button('Insert Table', 'table', { menu: 'table', disabled: !state('table-insert')?.enabled })}
        </div>
      </div>
    </div>
    {menu && menuContent ? createPortal(<div ref={menuRef} className={`document-toolbar-menu document-toolbar-menu-${menu.id}`} role="menu" aria-label={`${menu.id} options`} style={{ left: menu.left, top: menu.top }} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (menu.id === 'fonts' && event.key !== ' ' && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        const previous = now - fontSearchRef.current.time < 700 ? fontSearchRef.current.text : '';
        const text = previous + event.key.toLowerCase();
        fontSearchRef.current = { text, time: now };
        const match = buttons.find((button) => button.dataset.fontName?.toLowerCase().startsWith(text))
          ?? buttons.find((button) => button.dataset.fontName?.toLowerCase().startsWith(event.key.toLowerCase()));
        match?.focus();
      }
      if (event.key === 'Tab') closeMenu();
    }}>{menuContent}</div>, document.body) : null}
    {status ? <div className="document-toolbar-status" role="status"><span>{status}</span><button type="button" aria-label="Dismiss toolbar message" onClick={() => setStatus('')}>×</button></div> : null}
  </>;
}
