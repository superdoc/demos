import { useRef } from 'react';
import type { SelectionCapture } from 'superdoc/ui';
import {
  useSuperDocCommand,
  useSuperDocFontOptions,
  useSuperDocFontSizeOptions,
  useSuperDocUI,
} from 'superdoc/ui/react';
import { StyleGallery } from './StyleGallery';

function NativeFontControls() {
  const ui = useSuperDocUI();
  const fontState = useSuperDocCommand('font-family');
  const sizeState = useSuperDocCommand('font-size');
  const fonts = useSuperDocFontOptions();
  const sizes = useSuperDocFontSizeOptions();
  const selectionCapture = useRef<SelectionCapture | null>(null);
  const fontValue = String(fontState.value ?? fonts[0]?.value ?? 'Arial');
  const sizeValue = String(sizeState.value ?? sizes.find((size) => size.value === '12')?.value ?? sizes[0]?.value ?? '12');

  const preserveSelection = () => {
    selectionCapture.current = ui?.selection.capture() ?? null;
  };

  const execute = (command: string, value: string | number) => {
    if (selectionCapture.current) ui?.selection.restore(selectionCapture.current);
    ui?.commands.execute(command, value);
  };

  return (
    <div className="native-font-controls" aria-label="Font controls">
      <select
        aria-label="Font family"
        value={fontValue}
        onPointerDown={preserveSelection}
        onChange={(event) => execute('font-family', event.target.value)}
      >
        {!fonts.some((font) => font.value === fontValue) ? <option value={fontValue}>{fontValue}</option> : null}
        {fonts.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
      </select>

      <select
        aria-label="Font size"
        value={sizeValue}
        onPointerDown={preserveSelection}
        onChange={(event) => execute('font-size', Number(event.target.value))}
      >
        {!sizes.some((size) => size.value === sizeValue) ? <option value={sizeValue}>{sizeValue}</option> : null}
        {sizes.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
      </select>
    </div>
  );
}

export function Ribbon() {
  return (
    <div className="ribbon-controls-row default-toolbar-row">
      <NativeFontControls />
      <div id="default-toolbar" className="default-toolbar" aria-label="Document toolbar" />
      <StyleGallery />
    </div>
  );
}
