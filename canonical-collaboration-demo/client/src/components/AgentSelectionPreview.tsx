import { useEffect, useState } from 'react';
import type { BrowserDocumentApi, SelectionSlice, SelectionTarget } from 'superdoc/ui';

type TableSelection = NonNullable<SelectionSlice['tableSelection']>;
type SelectionSource = TableSelection | SelectionTarget;
type Capture = Awaited<ReturnType<BrowserDocumentApi['selection']['extractOoxml']>>;
type PreviewCell = { text: string; rowSpan: number; colSpan: number };
type PreviewRow = { header: boolean; cells: PreviewCell[] };
type PreviewBlock = { kind: 'text'; text: string } | { kind: 'table'; rows: PreviewRow[] };

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wordChildren(parent: Element, name: string) {
  return Array.from(parent.children).filter((child) => child.namespaceURI === WORD && child.localName === name);
}

function cellText(element: Element): string {
  if (element.namespaceURI === WORD) {
    switch (element.localName) {
      case 'del':
      case 'moveFrom': return '';
      case 't': return element.textContent ?? '';
      case 'tab': return '\t';
      case 'br':
      case 'cr': return '\n';
      case 'p': return Array.from(element.children).map(cellText).join('') + '\n';
    }
  }
  return Array.from(element.children).map(cellText).join('');
}

function previewRows(root: Element, positions?: NonNullable<Capture['fragment']['table']>['cells']): PreviewRow[] {
  let cellIndex = 0;
  const merged = new Map<number, { rowIndex: number; cell: PreviewCell }>();
  return wordChildren(root, 'tr').map((row, index) => {
    const rowProperties = wordChildren(row, 'trPr')[0];
    const header = rowProperties && wordChildren(rowProperties, 'tblHeader')[0];
    const gridBefore = rowProperties && wordChildren(rowProperties, 'gridBefore')[0];
    let nextColumn = Number(gridBefore?.getAttributeNS(WORD, 'val')) || 0;
    const cells = wordChildren(row, 'tc').flatMap((element) => {
      const position = positions?.[cellIndex++];
      const properties = wordChildren(element, 'tcPr')[0];
      const gridSpan = properties && wordChildren(properties, 'gridSpan')[0];
      const merge = properties && wordChildren(properties, 'vMerge')[0];
      const rowIndex = position?.rowIndex ?? index;
      const columnIndex = position?.columnIndex ?? nextColumn;
      const colSpan = position?.gridSpan ?? (Number(gridSpan?.getAttributeNS(WORD, 'val')) || 1);
      const vMerge = position?.vMerge ?? (merge ? merge.getAttributeNS(WORD, 'val') ?? 'continue' : 'none');
      nextColumn = columnIndex + colSpan;
      const owner = merged.get(columnIndex);
      if (vMerge === 'continue' && owner && owner.rowIndex + owner.cell.rowSpan === rowIndex) {
        owner.cell.rowSpan++;
        return [];
      }
      const cell = { text: cellText(element).replace(/\n$/, ''), colSpan, rowSpan: 1 };
      if (vMerge === 'restart') merged.set(columnIndex, { rowIndex, cell });
      else merged.delete(columnIndex);
      return [cell];
    });
    return { header: !!header && !['0', 'false', 'off'].includes(header.getAttributeNS(WORD, 'val') ?? ''), cells };
  });
}

function previewBlocks({ xml, table, placement }: Capture['fragment']): PreviewBlock[] | undefined {
  if (placement !== 'table') return;
  const root = new DOMParser().parseFromString(`<selection>${xml}</selection>`, 'application/xml').documentElement;

  function readBlocks(parent: Element): PreviewBlock[] {
    return Array.from(parent.children).flatMap((child): PreviewBlock[] => {
      if (child.namespaceURI === WORD) {
        if (child.localName === 'del' || child.localName === 'moveFrom') return [];
        if (child.localName === 'p') return [{ kind: 'text', text: cellText(child).replace(/\n$/, '') }];
        if (child.localName === 'tbl') {
          const rows = previewRows(child, table?.cells);
          return rows.length ? [{ kind: 'table', rows }] : [];
        }
      }
      return readBlocks(child);
    });
  }

  const blocks = readBlocks(root);
  if (blocks.some((block) => block.kind === 'table')) return blocks;
}

function previewTarget(source: SelectionSource): Parameters<BrowserDocumentApi['selection']['extractOoxml']>[0]['at'] {
  if (source.kind === 'selection') return source;
  if (source.type === 'table') {
    const node = { kind: 'block', nodeType: 'table', nodeId: source.tableId, story: source.story } as const;
    return {
      kind: 'selection',
      start: { kind: 'nodeEdge', node, edge: 'before' },
      end: { kind: 'nodeEdge', node, edge: 'after' },
    };
  }
  if (source.isRectangular) {
    const { kind, tableId, start, end, story } = source;
    return { kind, tableId, start, end, story };
  }
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <table className="selection-preview-table">
      <tbody>
        {rows.map(({ header, cells }, row) => (
          <tr key={row}>{cells.map(({ text, rowSpan, colSpan }, column) => {
            const Cell = header ? 'th' : 'td';
            return <Cell key={column} rowSpan={rowSpan} colSpan={colSpan} scope={header ? (colSpan > 1 ? 'colgroup' : 'col') : undefined}>{text}</Cell>;
          })}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function AgentSelectionPreview({ doc, text, table, target, onClear }: {
  doc?: BrowserDocumentApi | null;
  text: string;
  table?: TableSelection | null;
  target?: SelectionTarget | null;
  onClear: () => void;
}) {
  const rangeSpansBlocks = target && (target.start.kind !== 'text' || target.end.kind !== 'text'
    || target.start.blockId !== target.end.blockId);
  const source = table ?? (rangeSpansBlocks ? target : undefined);
  const [preview, setPreview] = useState<{ doc: BrowserDocumentApi; source: SelectionSource; text: string; blocks: PreviewBlock[] }>();
  useEffect(() => {
    if (!doc || !source) return;
    const at = previewTarget(source);
    if (!at) return;
    let current = true;
    const read = async () => {
      try {
        const { fragment } = await doc.selection.extractOoxml({ at });
        const blocks = previewBlocks(fragment);
        if (current && blocks) setPreview({ doc, source, text, blocks });
      } catch { /* Keep the quoted text when the selection cannot be read as a fragment. */ }
    };
    void read();
    return () => { current = false; };
  }, [doc, source, text]);

  const blocks = preview && preview.doc === doc && preview.source === source && preview.text === text ? preview.blocks : undefined;
  const label = table && blocks ? 'Selected table' : 'Selected text';
  if (!text && !blocks) return null;

  return (
    <section className="selection-preview" aria-label={label}>
      <div className="selection-preview-heading">
        <span>{label}</span>
        <button type="button" className="clear-selection" onClick={onClear} aria-label={`Clear ${label.toLowerCase()}`}>Clear</button>
      </div>
      <div className="selection-preview-content" tabIndex={0}>
        {blocks ? blocks.map((block, index) => block.kind === 'table'
          ? <PreviewTable key={index} rows={block.rows} />
          : <p key={index}>{block.text}</p>) : text}
      </div>
    </section>
  );
}
