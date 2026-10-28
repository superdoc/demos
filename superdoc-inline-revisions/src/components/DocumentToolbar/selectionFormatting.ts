import type { PartialBrowserDocumentApi, SelectionInfo } from 'superdoc/ui';

const MAIN_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Read the selected run properties through the public selection API. */
export async function hasSelectedVerticalAlignment(
  doc: PartialBrowserDocumentApi,
  selection: SelectionInfo,
  alignment: 'subscript' | 'superscript',
): Promise<boolean> {
  if (!doc.selection?.extractOoxml || !selection.selectionTarget) return false;
  const capture = await doc.selection.extractOoxml({ at: selection.selectionTarget });
  const namespaces = Object.entries(capture.fragment.namespaces)
    .map(([prefix, uri]) => `${prefix ? `xmlns:${prefix}` : 'xmlns'}="${uri.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ');
  const xml = new DOMParser().parseFromString(`<selection ${namespaces}>${capture.fragment.xml}</selection>`, 'application/xml');
  if (xml.querySelector('parsererror')) return false;
  const runs = [...xml.getElementsByTagNameNS(MAIN_NAMESPACE, 'r')].filter((run) =>
    run.getElementsByTagNameNS(MAIN_NAMESPACE, 't').length > 0 || run.getElementsByTagNameNS(MAIN_NAMESPACE, 'delText').length > 0);
  return runs.length > 0 && runs.every((run) => {
    const props = [...run.children].find((child) => child.namespaceURI === MAIN_NAMESPACE && child.localName === 'rPr');
    const vertical = props && [...props.children].find((child) => child.namespaceURI === MAIN_NAMESPACE && child.localName === 'vertAlign');
    return vertical?.getAttributeNS(MAIN_NAMESPACE, 'val') === alignment;
  });
}
