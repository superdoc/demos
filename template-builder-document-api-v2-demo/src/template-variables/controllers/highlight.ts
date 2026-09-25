import type { SuperDoc } from 'superdoc';
import type { SelectionTarget, ViewportRect } from 'superdoc/ui';
import { CONDITIONAL_QUERY_PATTERN, INTERPOLATION_QUERY_PATTERN } from '../helpers';

export type VariablePreviewRange = {
  target: SelectionTarget;
  raw: string;
  outcome: 'rendered' | 'hidden';
  rects: readonly ViewportRect[];
};

type VariableHighlightOptions = {
  onHover: (raw: string, event: PointerEvent) => void;
  onLeave: () => void;
};

/** Owns non-document overlays for template syntax and rendered preview ranges. */
export class VariableHighlightController {
  private enabled = false;
  private syntaxTargets: SelectionTarget[] = [];
  private previewRanges: VariablePreviewRange[] = [];
  private syntaxOverlay: HTMLDivElement | null = null;
  private previewOverlay: HTMLDivElement | null = null;
  private readonly stopViewportObserver: () => void;

  constructor(
    private readonly superdoc: SuperDoc,
    private readonly options: VariableHighlightOptions,
  ) {
    this.stopViewportObserver = superdoc.ui.viewport.observe(() => {
      if (!this.enabled) return;
      this.refreshPreviewRects();
      this.paint();
    });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async toggle(): Promise<boolean> {
    if (this.enabled) {
      this.disable();
      return false;
    }
    await this.enable();
    return true;
  }

  async enable(discoverSyntax = true): Promise<void> {
    if (discoverSyntax) await this.discoverSyntaxTargets();
    this.enabled = true;
    this.refreshPreviewRects();
    this.paint();
  }

  disable(): void {
    this.enabled = false;
    this.syntaxTargets = [];
    this.removeOverlays();
    this.options.onLeave();
  }

  setPreviewRanges(ranges: readonly VariablePreviewRange[]): void {
    this.previewRanges = ranges.map(range => ({ ...range }));
    if (!this.enabled) return;
    this.refreshPreviewRects();
    this.paintPreviewRanges();
  }

  destroy(): void {
    this.stopViewportObserver();
    this.disable();
    this.previewRanges = [];
  }

  private async discoverSyntaxTargets(): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) {
      this.syntaxTargets = [];
      return;
    }
    const matches = await documentApi.query.match({
      select: {
        type: 'text',
        pattern: `(?:${CONDITIONAL_QUERY_PATTERN}|${INTERPOLATION_QUERY_PATTERN})`,
        mode: 'regex',
        caseSensitive: true,
      },
      limit: 10000,
    });
    this.syntaxTargets = matches.items.flatMap(match => match.matchKind === 'text' ? [match.target] : []);
  }

  private paint(): void {
    this.paintSyntaxTargets();
    this.paintPreviewRanges();
  }

  private paintSyntaxTargets(): void {
    this.syntaxOverlay?.remove();
    this.syntaxOverlay = null;
    if (!this.enabled || !this.syntaxTargets.length) return;
    const host = this.getHost();
    if (!host) return;
    const overlay = this.createOverlay(30);
    for (const target of this.syntaxTargets) {
      const geometry = this.superdoc.ui.viewport.getRect({ target, relativeTo: host });
      if (!geometry.found) continue;
      for (const rect of geometry.rects) {
        overlay.appendChild(this.createRect(rect, {
          background: 'rgba(250, 204, 21, 0.35)',
          boxShadow: 'inset 0 0 0 4px rgba(202, 138, 4, 0.45)',
        }));
      }
    }
    host.appendChild(overlay);
    this.syntaxOverlay = overlay;
  }

  private paintPreviewRanges(): void {
    this.previewOverlay?.remove();
    this.previewOverlay = null;
    if (!this.enabled || !this.previewRanges.length) return;
    const host = this.getHost();
    if (!host) return;
    const overlay = this.createOverlay(31);
    for (const range of this.previewRanges) {
      for (const rect of range.rects) {
        const highlight = this.createRect(rect, range.outcome === 'rendered'
          ? {
              background: 'rgba(59, 130, 246, 0.26)',
              boxShadow: 'inset 0 0 0 2px rgba(37, 99, 235, 0.3)',
            }
          : {
              background: 'rgba(236, 72, 153, 0.28)',
              boxShadow: 'inset 0 0 0 2px rgba(219, 39, 119, 0.32)',
            });
        highlight.style.pointerEvents = 'auto';
        highlight.style.cursor = 'help';
        highlight.addEventListener('pointermove', event => this.options.onHover(range.raw, event));
        highlight.addEventListener('pointerleave', this.options.onLeave);
        overlay.appendChild(highlight);
      }
    }
    host.appendChild(overlay);
    this.previewOverlay = overlay;
  }

  private refreshPreviewRects(): void {
    const host = this.getHost();
    if (!host) return;
    this.previewRanges = this.previewRanges.map(range => {
      const geometry = this.superdoc.ui.viewport.getRect({ target: range.target, relativeTo: host });
      return { ...range, rects: geometry.found ? geometry.rects : [] };
    });
  }

  private getHost(): HTMLElement | null {
    const host = this.superdoc.ui.viewport.getHost();
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    return host;
  }

  private createOverlay(zIndex: number): HTMLDivElement {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      zIndex: String(zIndex),
      pointerEvents: 'none',
    });
    return overlay;
  }

  private createRect(rect: ViewportRect, style: { background: string; boxShadow: string }): HTMLDivElement {
    const horizontalInset = Math.min(1, rect.width / 4);
    const verticalInset = Math.min(2, rect.height / 4);
    const highlight = document.createElement('div');
    Object.assign(highlight.style, {
      position: 'absolute',
      left: `${rect.left + horizontalInset}px`,
      top: `${rect.top + verticalInset}px`,
      width: `${Math.max(1, rect.width - horizontalInset * 2)}px`,
      height: `${Math.max(1, rect.height - verticalInset * 2)}px`,
      background: style.background,
      borderRadius: '2px',
      boxShadow: style.boxShadow,
    });
    return highlight;
  }

  private removeOverlays(): void {
    this.syntaxOverlay?.remove();
    this.previewOverlay?.remove();
    this.syntaxOverlay = null;
    this.previewOverlay = null;
  }
}
