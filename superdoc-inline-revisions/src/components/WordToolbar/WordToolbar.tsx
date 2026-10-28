import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SelectionCapture, SelectionTarget } from 'superdoc/ui';
import { useSuperDocFontOptions, useSuperDocFontSizeOptions, useSuperDocHost, useSuperDocToolbar, useSuperDocUI } from 'superdoc/ui/react';
import { ToolbarIcon } from './ToolbarIcon';
import type { IconName } from './ToolbarIcon';
import './WordToolbar.css';

type MenuId = 'table' | 'underline' | 'case' | 'highlight' | 'color' | 'bullets' | 'numbers' | 'multilevel' | 'spacing';
type OpenMenu = { id: MenuId; left: number; top: number; trigger: HTMLButtonElement };

// These controls intentionally remain no-ops until their desired behavior is specified.
export const WORD_TOOLBAR_PLACEHOLDERS = [
  'Multilevel list presets',
  'Define New Multilevel List', 'Define New List Style',
] as const;

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
const MULTILEVEL = [
  { label: 'Numbers and letters', markers: ['1)', 'a)', 'i)'] },
  { label: 'Decimal outline', markers: ['1.', '1.1.', '1.1.1.'] },
  { label: 'Symbol outline', markers: ['❖', '➢', '▪'] },
  { label: 'Article and section headings', markers: ['Article I.', 'Section 1.01', '(a)'] },
  { label: 'Numbered headings', markers: ['1 Heading 1', '1.1 Heading 2', '1.1.1 Heading 3'] },
  { label: 'Roman outline', markers: ['I. Heading 1', 'A. Heading 2', '1. Heading 3'] },
  { label: 'Chapter headings', markers: ['Chapter 1', 'Heading 2', 'Heading 3'] },
];

function ListPreview({ markers, nested = false }: { markers: string[]; nested?: boolean }) {
  return <span className={`word-list-preview${nested ? ' is-nested' : ''}`} aria-hidden="true">{markers.map((marker, index) => <span key={index} style={nested ? { paddingLeft: index * 8 } : undefined}><span>{marker}</span><i /></span>)}</span>;
}

/** Reusable SuperDoc toolbar. Render under SuperDocUIProvider; compose a style gallery separately. */
export function WordToolbar({ className = '' }: { className?: string }) {
  const ui = useSuperDocUI();
  const host = useSuperDocHost();
  const toolbar = useSuperDocToolbar();
  const fonts = useSuperDocFontOptions();
  const sizes = useSuperDocFontSizeOptions();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [status, setStatus] = useState('');
  const [tableSize, setTableSize] = useState({ rows: 1, columns: 1 });
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<SelectionCapture | null>(null);
  const tableTargetRef = useRef<SelectionTarget | null>(null);
  const state = (command: string) => toolbar.commands[command];
  const readOnly = !ui || toolbar.context === 'viewing';
  const font = String(state('font-family')?.value ?? 'Calibri');
  const size = String(state('font-size')?.value ?? '11');

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
      await ui?.commands.executeAsync(command, payload);
    } catch { reportError('The formatting could not be applied to this selection.'); }
  };
  const openMenu = (id: MenuId, trigger: HTMLButtonElement) => {
    if (menu?.id === id) return closeMenu();
    preserve();
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
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

  const verticalAlign = async (value: 'subscript' | 'superscript') => {
    const capture = restore() ?? ui?.selection.capture();
    if (readOnly || !capture?.selectionTarget || capture.empty) return;
    try {
      const result = await host?.activeEditor?.doc?.format?.apply?.({ target: capture.selectionTarget, inline: { vertAlign: capture.activeMarks.includes(value) ? 'baseline' : value } }, { changeMode: toolbar.context === 'suggesting' ? 'tracked' : 'direct' });
      if (!result?.success) reportError('This formatting is unavailable for the current selection.');
    } catch { reportError('This formatting could not be applied.'); }
  };
  const changeCase = async (transform: (text: string) => string) => {
    const capture = restore();
    closeMenu();
    if (readOnly || !capture?.selectionTarget || capture.empty) return;
    try {
      const result = await host?.activeEditor?.doc?.invoke?.({ operationId: 'replace', input: { target: capture.selectionTarget, text: transform(capture.quotedText) }, options: { changeMode: toolbar.context === 'suggesting' ? 'tracked' : 'direct' } });
      if (!result || typeof result !== 'object' || !('success' in result) || !result.success) reportError('The case could not be changed for this selection.');
    } catch { reportError('The case could not be changed for this selection.'); }
  };
  const placeholder = () => closeMenu();
  const button = (label: string, icon: IconName, options: { command?: string; payload?: unknown; menu?: MenuId; action?: () => void; active?: boolean; disabled?: boolean; className?: string } = {}) => (
    <button type="button" className={`word-tool ${options.className ?? ''}${(options.active ?? (options.command ? state(options.command)?.active : false)) ? ' is-active' : ''}`} aria-label={label} title={!options.command && !options.menu && !options.action ? `${label} (no-op)` : label}
      data-noop={!options.command && !options.menu && !options.action || undefined}
      disabled={options.disabled ?? (options.command ? !state(options.command)?.enabled : readOnly)}
      aria-pressed={options.command || options.active !== undefined ? options.active ?? state(options.command ?? '')?.active ?? false : undefined}
      aria-haspopup={options.menu ? 'menu' : undefined} aria-expanded={options.menu ? menu?.id === options.menu : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => options.menu ? openMenu(options.menu, event.currentTarget) : options.action ? options.action() : options.command ? void run(options.command, options.payload) : undefined}>
      <ToolbarIcon name={icon} />{options.menu ? <span className="word-caret" aria-hidden="true" /> : null}
    </button>
  );
  const split = (label: string, icon: IconName, command: string, id: MenuId, payload?: unknown) => (
    <span className="word-split">{button(label, icon, { command, payload })}<button type="button" className="word-tool word-menu-arrow" aria-label={`${label} options`} title={`${label} options`} aria-haspopup="menu" aria-expanded={menu?.id === id} disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={(event) => openMenu(id, event.currentTarget)}><span className="word-caret" aria-hidden="true" /></button></span>
  );
  const item = (label: string, action: () => void, children?: ReactNode) => <button type="button" role="menuitem" className={children ? 'word-gallery-tile' : 'word-menu-item'} aria-label={label} title={action === placeholder ? `${label} (no-op)` : label} data-noop={action === placeholder || undefined} onMouseDown={(event) => event.preventDefault()} onClick={action}>{children ?? label}</button>;
  const none = () => {
    // Both libraries' None tile removes either kind of list from the selected paragraphs.
    if (state('bullet-list')?.active) void run('bullet-list');
    else if (state('numbered-list')?.active) void run('numbered-list');
    else { restore(); closeMenu(); }
  };
  let menuContent: ReactNode;
  switch (menu?.id) {
    case 'table': menuContent = <>
      <div className="word-menu-heading">Insert Table</div>
      <div className="word-table-size">{tableSize.columns} × {tableSize.rows} Table</div>
      <div className="word-table-grid" onPointerLeave={() => setTableSize({ rows: 1, columns: 1 })}>
        {Array.from({ length: 48 }, (_, index) => {
          const rows = Math.floor(index / 8) + 1;
          const columns = index % 8 + 1;
          return <button key={index} type="button" role="menuitem" aria-label={`Insert ${columns} column by ${rows} row table`} title={`${columns} × ${rows} Table`} className={rows <= tableSize.rows && columns <= tableSize.columns ? 'is-selected' : ''} onPointerEnter={() => setTableSize({ rows, columns })} onFocus={() => setTableSize({ rows, columns })} onMouseDown={(event) => event.preventDefault()} onClick={() => void run('table-insert', { rows, columns })} />;
        })}
      </div>
    </>; break;
    case 'bullets': menuContent = <><div className="word-menu-heading">Bullet Library</div><div className="word-bullet-grid">{item('No bullets', () => none(), <span>None</span>)}{[['Disc', 'disc', '●'], ['Circle', 'circle', '○'], ['Square', 'square', '▪']].map(([label, preset, glyph]) => <span key={preset}>{item(label, () => void run('bullet-list', { preset, behavior: 'toggleStyle' }), <span className="word-bullet-glyph">{glyph}</span>)}</span>)}</div></>; break;
    case 'numbers': menuContent = <><div className="word-menu-heading">Numbering Library</div><div className="word-number-grid">{item('No numbering', () => none(), <span>None</span>)}{NUMBERS.map(({ label, preset, markers }) => <span key={preset}>{item(label, () => void run('numbered-list', { preset, behavior: 'toggleStyle' }), <ListPreview markers={markers} />)}</span>)}</div></>; break;
    case 'multilevel': menuContent = <><div className="word-menu-heading">Current List</div><div className="word-current-list">{state('numbered-list')?.active || state('bullet-list')?.active ? <ListPreview nested markers={state('bullet-list')?.active ? ['•', '○', '▪'] : ['1.', 'a.', 'i.']} /> : <span>None</span>}</div><div className="word-menu-heading">List Library</div><div className="word-number-grid">{item('No multilevel list', () => none(), <span>None</span>)}{MULTILEVEL.map(({ label, markers }) => <span key={label}>{item(label, placeholder, <ListPreview nested markers={markers} />)}</span>)}</div>{item('Define New Multilevel List…', placeholder)}{item('Define New List Style…', placeholder)}</>; break;
    case 'spacing': menuContent = <>{[1, 1.15, 1.5, 2, 2.5, 3].map((value) => <span key={value}>{item(String(value), () => void run('line-height', value))}</span>)}</>; break;
    case 'color': case 'highlight': menuContent = <><div className="word-menu-heading">{menu.id === 'color' ? 'Font Color' : 'Text Highlight Color'}</div><div className="word-color-grid">{COLORS.map((color) => <button type="button" role="menuitem" key={color} aria-label={`Apply ${color}`} title={color} style={{ backgroundColor: color }} onMouseDown={(event) => event.preventDefault()} onClick={() => void run(menu.id === 'color' ? 'text-color' : 'highlight-color', color)} />)}</div>{menu.id === 'highlight' ? item('No Color', () => void run('highlight-color', 'none')) : item('Automatic', () => void run('text-color', '#000000'))}</>; break;
    case 'case': menuContent = <>{item('Sentence case.', () => void changeCase((text) => text.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (letter) => letter.toUpperCase())))}{item('lowercase', () => void changeCase((text) => text.toLowerCase()))}{item('UPPERCASE', () => void changeCase((text) => text.toUpperCase()))}{item('Capitalize Each Word', () => void changeCase((text) => text.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())))}{item('tOGGLE cASE', () => void changeCase((text) => [...text].map((letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()).join('')))}</>; break;
    case 'underline': menuContent = <>{item('Underline', () => void run('underline'))}</>; break;
  }

  return <>
    <div ref={rootRef} className={`word-toolbar ${className}`} role="toolbar" aria-label="Document toolbar">
      <div className="word-font-group" role="group" aria-label="Font">
        <div className="word-tool-row">
          <select aria-label="Font family" className="word-font-select" value={font} disabled={readOnly} onPointerDown={preserve} onChange={(event) => void run('font-family', event.target.value)}>
            {!fonts.some((option) => option.value === font) ? <option value={font}>{font}</option> : null}
            {fonts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select aria-label="Font size" className="word-size-select" value={size} disabled={readOnly} onPointerDown={preserve} onChange={(event) => void run('font-size', Number(event.target.value))}>
            {!sizes.some((option) => option.value === size) ? <option value={size}>{size}</option> : null}
            {sizes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {button('Grow Font', 'grow', { command: 'font-size', payload: Math.min(1638, Number(size) + 1) })}
          {button('Shrink Font', 'shrink', { command: 'font-size', payload: Math.max(1, Number(size) - 1) })}
          <span className="word-divider" />
          {button('Change Case', 'case', { menu: 'case' })}
          <span className="word-divider" />
          {button('Clear All Formatting', 'clear', { command: 'clear-formatting' })}
        </div>
        <div className="word-tool-row word-font-bottom">
          {button('Bold', 'bold', { command: 'bold' })}{button('Italic', 'italic', { command: 'italic' })}
          {split('Underline', 'underline', 'underline', 'underline')}
          {button('Strikethrough', 'strike', { command: 'strikethrough' })}
          {button('Subscript', 'subscript', { action: () => void verticalAlign('subscript') })}
          {button('Superscript', 'superscript', { action: () => void verticalAlign('superscript') })}
          <span className="word-divider" />
          {split('Text Highlight Color', 'highlight', 'highlight-color', 'highlight', '#fff200')}
          {split('Font Color', 'color', 'text-color', 'color', '#e50022')}
        </div>
      </div>
      <div className="word-paragraph-group" role="group" aria-label="Paragraph">
        <div className="word-tool-row">
          {split('Bullets', 'bullets', 'bullet-list', 'bullets')}
          {split('Numbering', 'numbers', 'numbered-list', 'numbers')}
          {button('Multilevel List', 'multilevel', { menu: 'multilevel' })}
          <span className="word-divider" />
          {button('Decrease Indent', 'outdent', { command: 'indent-decrease' })}
          {button('Increase Indent', 'indent', { command: 'indent-increase' })}
          <span className="word-divider" />
          {button('Show/Hide Formatting Marks', 'marks', { command: 'formatting-marks' })}
        </div>
        <div className="word-tool-row word-paragraph-bottom">
          {(['left', 'center', 'right', 'justify'] as const).map((value) => <span key={value}>{button(value === 'justify' ? 'Justify' : `Align ${value}`, value, { command: 'text-align', payload: value, active: state('text-align')?.value === value })}</span>)}
          <span className="word-divider" />
          {button('Line and Paragraph Spacing', 'spacing', { menu: 'spacing' })}
          <span className="word-divider" />
          {button('Insert Table', 'table', { menu: 'table', disabled: !state('table-insert')?.enabled })}
        </div>
      </div>
    </div>
    {menu && menuContent ? createPortal(<div ref={menuRef} className={`word-toolbar-menu word-menu-${menu.id}`} role="menu" aria-label={`${menu.id} options`} style={{ left: menu.left, top: menu.top }} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (event.key === 'Tab') closeMenu();
    }}>{menuContent}</div>, document.body) : null}
    {status ? <div className="word-toolbar-status" role="status"><span>{status}</span><button type="button" aria-label="Dismiss toolbar message" onClick={() => setStatus('')}>×</button></div> : null}
  </>;
}
