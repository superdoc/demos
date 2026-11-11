import { useEffect, useRef, useState } from "react";
import { SuperDoc } from "superdoc";
import "superdoc/style.css";
import OutlineNavigation from "./OutlineNavigation";
import { useOutline } from "./use-outline";
import type { Entry } from "./read-outline";
import { revealOutlineEntry } from "./navigate-outline";
import buildCommand from "./build-app.sh?raw";
import "./style.css";
const base = import.meta.env.BASE_URL;
export default function App() {
  const dialog = useRef<HTMLDialogElement>(null);
  const mount = useRef<HTMLDivElement>(null),
    instance = useRef<SuperDoc | null>(null),
    request = useRef(0);
  const [editor, setEditor] = useState<SuperDoc | null>(null),
    [file, setFile] = useState<string | File>(`${base}project-brief.docx`);
  const [name, setName] = useState("Meridian project brief"),
    [error, setError] = useState(""),
    [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState(false),
    [detect, setDetect] = useState(false),
    [panel, setPanel] = useState(true),
    [build, setBuild] = useState(false),
    [copied, setCopied] = useState(false),
    [exporting, setExporting] = useState(false);
  const outline = useOutline(editor, detect);
  useEffect(() => {
    if (build) dialog.current?.showModal();
    else dialog.current?.close();
  }, [build]);
  useEffect(() => {
    if (!mount.current) return;
    let disposed = false;
    setEditor(null);
    setEditing(false);
    setActive(null);
    setError("");
    const current = new SuperDoc({
      selector: mount.current,
      document: file,
      telemetry: { enabled: false },
      documentMode: "editing",
      zoom: { mode: "fit-width", fitWidth: { min: 20, max: 100, padding: 20 } },
      user: { name: "Demo reviewer", email: "reviewer@example.invalid" },
      ui: { toolbar: false, comments: false },
      onReady: ({ superdoc }) => {
        if (!disposed) {
          superdoc.setDocumentMode("viewing");
          superdoc.ui.zoom.setMode("fit-width");
          setEditor(superdoc);
        }
      },
      onException: () => {
        if (!disposed)
          setError(
            "The document could not open. Try reloading the sample or choose another DOCX.",
          );
      },
    });
    instance.current = current;
    return () => {
      disposed = true;
      request.current++;
      current.destroy();
      instance.current = null;
    };
  }, [file]);
  useEffect(() => {
    if (!editor) return;
    return editor.ui.document.observe((state) =>
      setEditing(state.mode === "editing"),
    );
  }, [editor]);
  async function navigate(item: Entry) {
    if (!editor || !item.within) return;
    const generation = ++request.current;
    setError("");
    try {
      const reached = await revealOutlineEntry(
        editor,
        item,
        () => generation === request.current,
      );
      if (generation !== request.current) return;
      if (!reached) throw new Error("unreachable");
      setActive(item.id);
      if (window.matchMedia("(max-width: 850px)").matches) setPanel(false);
    } catch {
      if (generation === request.current)
        setError(
          "This section could not be reached. Refresh the document and try again.",
        );
    }
  }
  function sample(unstyled: boolean) {
    setName(unstyled ? "Unstyled project brief" : "Meridian project brief");
    setFile(`${base}${unstyled ? "unstyled-brief" : "project-brief"}.docx`);
  }
  async function download() {
    if (!editor) return;
    setExporting(true);
    setError("");
    try {
      const blob = await editor.export({
        exportType: ["docx"],
        triggerDownload: false,
      });
      if (!(blob instanceof Blob)) throw new Error("export");
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "meridian-brief.docx";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      setError("The Word file could not be prepared. Please retry.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="https://superdoc.dev">
          <img src={`${base}superdoc-logo.png`} alt="SuperDoc" />
        </a>
        <span className="demo-tag">DOCUMENT OUTLINE</span>
        <nav>
          <a href={`${base}guide.md`}>Build guide</a>
          <a href="https://github.com/superdoc/demos/tree/main/document-outline">
            Source ↗
          </a>
          <button
            className="primary"
            onClick={() => {
              setBuild(true);
              setCopied(false);
            }}
          >
            Build this
          </button>
        </nav>
      </header>
      <section className="intro">
        <span className="eyebrow">A LITTLE STRUCTURE. A LOT MORE CLARITY.</span>
        <h1>
          Find your place.
          <br />
          <span>Keep your flow.</span>
        </h1>
        <p>
          A live outline, powered by your Word document. Jump to a section, edit
          a heading, and watch navigation follow along.
        </p>
        <div className="intro-notes">
          <span>Native DOCX headings</span>
          <span>Live updates</span>
          <span>Expandable sections</span>
        </div>
      </section>
      <main className="studio">
        <div className="studio-toolbar">
          <div>
            <strong>{name}</strong>
            <span className="status" role="status">
              {editor
                ? "Ready · changes stay in this tab"
                : "Opening document…"}
            </span>
          </div>
          <div className="tools">
            <button
              aria-label="Toggle document outline"
              aria-expanded={panel}
              onClick={() => setPanel(!panel)}
            >
              ☷ Outline
            </button>
            <label className="upload">
              Open DOCX
              <input
                aria-label="Open DOCX"
                type="file"
                accept=".docx"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (!selected) return;
                  if (
                    !selected.name.toLowerCase().endsWith(".docx") ||
                    selected.size > 25 * 1024 * 1024
                  ) {
                    setError("Choose a DOCX smaller than 25 MB.");
                    return;
                  }
                  setName(selected.name);
                  setFile(selected);
                }}
              />
            </label>
            <button
              disabled={!editor}
              onClick={() => editor?.ui.zoom.setMode("fit-width")}
            >
              Fit width
            </button>
            <button
              role="switch"
              aria-label="Edit document"
              aria-checked={editing}
              disabled={!editor}
              onClick={() =>
                editor?.setDocumentMode(editing ? "viewing" : "editing")
              }
            >
              {editing ? "Done editing" : "Start editing"}
            </button>
            <button
              disabled={!editor || exporting}
              onClick={() => void download()}
            >
              {exporting ? "Preparing…" : "Export Word ↗"}
            </button>
          </div>
        </div>
        <div className="sample-bar">
          <span>TRY IT</span>
          <button onClick={() => sample(false)}>Structured brief</button>
          <button onClick={() => sample(true)}>Unstyled brief</button>
          <span className="local-note">
            Files you open are processed in this browser.
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className={`workspace ${panel ? "with-outline" : ""}`}>
          <section className="canvas" aria-label="Word document">
            <div
              ref={mount}
              className="native-canvas"
              style={{ WebkitTextSizeAdjust: "100%", textSizeAdjust: "100%" }}
            />
          </section>
          {panel && (
            <aside className="sidebar">
              <div className="sidebar-heading">
                <div>
                  <span className="eyebrow">YOUR DOCUMENT, MAPPED</span>
                  <h2>Document outline</h2>
                </div>
                <button
                  aria-label="Close document outline"
                  onClick={() => setPanel(false)}
                >
                  ×
                </button>
              </div>
              <label className="detect">
                <input
                  type="checkbox"
                  checked={detect}
                  onChange={(e) => setDetect(e.target.checked)}
                />
                <span>
                  Detect section titles
                  <small>Include title-like text without heading styles.</small>
                </span>
              </label>
              {outline.loading ? (
                <p role="status">Reading headings…</p>
              ) : outline.error ? (
                <p role="alert">{outline.error}</p>
              ) : !outline.entries.length ? (
                <div className="empty">
                  <strong>No headings yet.</strong>
                  <p>
                    Try the structured brief, add a Word heading, or enable
                    detected section titles.
                  </p>
                </div>
              ) : (
                <OutlineNavigation
                  key={typeof file === "string" ? file : file.name}
                  items={outline.entries}
                  activeId={active}
                  disabled={!editor}
                  onNavigate={(id) => {
                    const item = outline.entries.find(
                      (entry) => entry.id === id,
                    );
                    if (item) void navigate(item);
                  }}
                />
              )}
              <p className="sidebar-foot">
                {detect
                  ? "Detected titles are navigation hints. They do not change Word heading styles."
                  : "Real headings, in document order. Expand a section to see its subheadings."}
              </p>
            </aside>
          )}
        </div>
      </main>
      <section className="explanation">
        <div>
          <span className="eyebrow">WHAT SUPERDOC MAKES POSSIBLE</span>
          <h2>
            Structure from the document.
            <br />
            An interface that’s yours.
          </h2>
        </div>
        <div>
          <p>
            <code>doc.info().outline</code> supplies native heading text,
            levels, and identities. The custom sidebar adds expandable
            navigation. SuperDoc’s document events keep it current, and its
            viewport API takes readers to the selected heading.
          </p>
          <p>
            Try <strong>Start editing</strong> and rename “Delivery plan.” The
            outline updates without saving or reloading. Opening the outline
            changes no document content.
          </p>
          <a href="https://docs.superdoc.dev/document-api/reference/info/">
            Explore the Document API ↗
          </a>
          <p className="fine">
            This example uses the public APIs in SuperDoc 2.29.0. The sidebar is
            reusable example code; no unreleased library option is required.
          </p>
        </div>
      </section>
      <footer>
        Built with SuperDoc. Made to be built on.{" "}
        <a href={`${base}guide.md`}>Read the recipe ↗</a>
      </footer>
      <dialog
        ref={dialog}
        aria-label="Build this app"
        onCancel={(e) => {
          e.preventDefault();
          setBuild(false);
        }}
      >
        <div className="dialog-top">
          <h2>Build this app</h2>
          <button
            autoFocus
            aria-label="Close build instructions"
            onClick={() => setBuild(false)}
          >
            ×
          </button>
        </div>
        <p>A static React app. No backend, accounts, or API keys required.</p>
        <pre>
          <code>{buildCommand}</code>
        </pre>
        <button
          className="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildCommand);
              setCopied(true);
            } catch {
              setError(
                "Copy is unavailable. Select the commands to copy them.",
              );
            }
          }}
        >
          {copied ? "Copied" : "Copy all commands"}
        </button>
        <a href={`${base}guide.md`}>Read the implementation guide ↗</a>
      </dialog>
    </div>
  );
}
