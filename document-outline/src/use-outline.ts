import { useEffect, useState } from "react";
import type { SuperDoc } from "superdoc";
import { readOutline, type Entry } from "./read-outline";
export function useOutline(editor: SuperDoc | null) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setEntries([]);
    setError("");
    setLoading(true);
    if (!editor) return;
    let disposed = false,
      generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const request = ++generation;
      try {
        const next = await readOutline(editor);
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
    const stop = editor.ui.document.onChange(() => {
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 200);
    });
    return () => {
      disposed = true;
      generation++;
      clearTimeout(timer);
      stop();
    };
  }, [editor]);
  return { entries, error, loading };
}
