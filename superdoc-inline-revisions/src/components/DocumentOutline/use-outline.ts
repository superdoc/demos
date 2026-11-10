import { useEffect, useState } from "react";
import type { BorrowedSuperDocUI, BrowserDocumentApi } from "superdoc/ui";
import type { SuperDocHost } from "superdoc/ui/react";
import { readOutline, type OutlineEntry } from "../../superdoc/outline";
export function useOutline(doc: BrowserDocumentApi | null, ui: BorrowedSuperDocUI | null, host: SuperDocHost | null, replacementVersion: number) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [documentVersion, setDocumentVersion] = useState(0);
  useEffect(() => {
    setEntries([]);
    setError("");
    setLoading(true);
    if (!doc || !ui) return;
    let disposed = false,
      generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const request = ++generation;
      try {
        const next = await readOutline(host?.getDocumentApi?.() ?? doc);
        if (!disposed && request === generation) {
          setEntries(next);
          setLoading(false);
          setError("");
        }
      } catch {
        if (!disposed && request === generation) {
          setEntries([]);
          setLoading(false);
          setError(
            "The outline could not be read. Reload the document to retry.",
          );
        }
      }
    };
    void refresh();
    const stop = ui.document.onChange(() => {
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 200);
    });
    const replace = () => {
      generation++;
      clearTimeout(timer);
      setEntries([]);
      setError("");
      setLoading(true);
      setDocumentVersion((version) => version + 1);
      timer = setTimeout(() => void refresh(), 200);
    };
    host?.on?.('active-editor-change', replace);
    return () => {
      host?.off?.('active-editor-change', replace);
      disposed = true;
      generation++;
      clearTimeout(timer);
      stop();
    };
  }, [doc, ui, host, replacementVersion]);
  return { entries, error, loading, documentVersion };
}
