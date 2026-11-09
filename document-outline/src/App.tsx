import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [panelWidth, setPanelWidth] = useState(360);
  const [panelMaxWidth, setPanelMaxWidth] = useState(720);
  const [resizing, setResizing] = useState(false);
  const mount = useRef<HTMLDivElement>(null),
    instance = useRef<SuperDoc | null>(null),
    request = useRef(0);
  const [editor, setEditor] = useState<SuperDoc | null>(null),
    [file, setFile] = useState<string | File>(`${base}project-brief.docx`);
  const [name, setName] = useState("Meridian project brief"),
    [error, setError] = useState(""),
    [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState(true),
    [build, setBuild] = useState(false),
    [copied, setCopied] = useState(false),
    [exporting, setExporting] = useState(false),
    [addingHeading, setAddingHeading] = useState(false);
  const outline = useOutline(editor);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const maximum = Math.max(300, Math.min(720, element.clientWidth - 320));
      setPanelMaxWidth(maximum);
      setPanelWidth((width) => Math.min(width, maximum));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function resizePanel(width: number) {
    setPanelWidth(Math.max(300, Math.min(panelMaxWidth, width)));
  }
  useEffect(() => {
    if (build) dialog.current?.showModal();
    else dialog.current?.close();
  }, [build]);
  useEffect(() => {
    if (!mount.current) return;
    let disposed = false;
    setEditor(null);
    setActive(null);
    setError("");
    const current = new SuperDoc({
      selector: mount.current,
      document: file,
      telemetry: { enabled: false },
      documentMode: "editing",
      zoom: { mode: "fit-width", fitWidth: { min: 20, max: 100, padding: 20 } },
      user: { name: "Demo reviewer", email: "reviewer@example.invalid" },
      ui: {
        toolbar: {
          container: "#superdoc-toolbar",
          groups: {
            center: [
              "fontFamily", "fontSize", "list", "numberedlist",
              "indentleft", "indentright", "lineHeight", "clearFormatting",
            ],
          },
          hideButtons: false,
        },
        comments: false,
      },
      onReady: ({ superdoc }) => {
        if (!disposed) {
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
  async function addHeading(level: 1 | 2) {
    const current = editor;
    const doc = current?.activeEditor?.doc;
    if (!current || !doc || addingHeading) return;
    const generation = ++request.current;
    setAddingHeading(true);
    setError("");
    try {
      const selection = await doc.selection.current();
      if (instance.current !== current || generation !== request.current) return;
      const end = selection.selectionTarget?.end;
      if (!end) {
        setError("Place the cursor in the document before adding a heading.");
        return;
      }
      const story = selection.selectionTarget?.story ??
        (end.kind === "text" ? end.story : end.node.story);
      const target = end.kind === "nodeEdge"
        ? end.node
        : (await doc.getNodeById({ nodeId: end.blockId, ...(story ? { story } : {}) })).address;
      if (instance.current !== current || generation !== request.current) return;
      if (target.kind !== "block") throw new Error("No insertion block");
      const text = `New heading ${level}`;
      const result = await doc.create.heading({
        level,
        text,
        at: { kind: "after", target },
        ...(story ? { in: story } : {}),
      });
      if (instance.current !== current || generation !== request.current) return;
      if (!result.success) throw new Error("Heading insertion failed");
      await navigate({
        id: `${JSON.stringify(story?.storyType === "body" ? null : story ?? null)}:${result.heading.nodeId}`,
        text,
        quote: text,
        level,
        story,
        within: { kind: "block", nodeType: "heading", nodeId: result.heading.nodeId },
      });
      if (instance.current !== current || request.current !== generation + 1) return;
      const applied = current.ui.selection.apply({
        kind: "selection",
        start: { kind: "text", blockId: result.heading.nodeId, offset: 0 },
        end: { kind: "text", blockId: result.heading.nodeId, offset: text.length },
        ...(story ? { story } : {}),
      });
      if (applied.ok) current.focus();
    } catch {
      if (instance.current === current && generation === request.current)
        setError("The heading could not be added. Please try again.");
    } finally {
      setAddingHeading(false);
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
        <div className="ribbon-tabs-row">
          <div className="file-title">
            <h1 className="file-name">{name}</h1>
            <span className="status visually-hidden" role="status">
              {editor ? "Ready · changes stay in this tab" : "Opening document…"}
            </span>
          </div>
          <input
            ref={fileInput}
            className="visually-hidden"
            aria-label="Open DOCX"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
              e.target.value = "";
            }}
          />
          <select
            className="file-menu"
            aria-label="File"
            defaultValue=""
            disabled={!editor || exporting}
            onChange={(e) => {
              if (e.target.value === "upload") fileInput.current?.click();
              if (e.target.value === "save-as") void download();
              e.target.value = "";
            }}
          >
            <option value="" disabled>{exporting ? "Preparing…" : "File"}</option>
            <option value="upload">Upload…</option>
            <option value="save-as">Save As…</option>
          </select>
          <a className="more-demos-button" href="/">More demos</a>
          <div className="build-this-slot">
            <button
              className="build-this-button"
              onClick={() => {
                setBuild(true);
                setCopied(false);
              }}
            >
              Build this
            </button>
          </div>
          <button
            className={`outline-panel-toggle ${panel ? "active" : ""}`}
            aria-label="Toggle document outline"
            aria-expanded={panel}
            onClick={() => setPanel(!panel)}
          >
            {panel ? "Hide outline" : "Show outline"}
          </button>
        </div>
        <div className="ribbon-controls-row">
          <div id="superdoc-toolbar" className="default-toolbar" aria-label="Document toolbar" />
        </div>
      </header>
      <main className="studio">
        <div className="sample-bar">
          <span>TRY IT</span>
          <button onClick={() => sample(false)}>Structured brief</button>
          <button onClick={() => sample(true)}>Unstyled brief</button>
          <button disabled={!editor || addingHeading} onPointerDown={(event) => event.preventDefault()} onClick={() => void addHeading(1)}>
            Add heading 1
          </button>
          <button disabled={!editor || addingHeading} onPointerDown={(event) => event.preventDefault()} onClick={() => void addHeading(2)}>
            Add heading 2
          </button>
          <span className="local-note">
            Files you open are processed in this browser.
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div
          ref={workspace}
          className={`workspace ${panel ? "with-outline" : ""} ${resizing ? "resizing" : ""}`}
          style={{ "--outline-width": `${panelWidth}px` } as CSSProperties}
        >
          <section className="canvas" aria-label="Word document">
            <div
              ref={mount}
              className="native-canvas"
              style={{ WebkitTextSizeAdjust: "100%", textSizeAdjust: "100%" }}
            />
          </section>
          {panel && (
            <>
            <div
              className="outline-resize-handle"
              role="separator"
              tabIndex={0}
              aria-label="Resize document outline"
              aria-orientation="vertical"
              aria-controls="document-outline-panel"
              aria-valuemin={300}
              aria-valuemax={panelMaxWidth}
              aria-valuenow={panelWidth}
              aria-valuetext={`${panelWidth} pixels wide`}
              title="Drag to resize the outline, or use the arrow keys"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                resizeStart.current = { x: event.clientX, width: panelWidth };
                setResizing(true);
              }}
              onPointerMove={(event) => {
                if (!resizeStart.current) return;
                resizePanel(resizeStart.current.width + resizeStart.current.x - event.clientX);
              }}
              onPointerUp={(event) => {
                resizeStart.current = null;
                setResizing(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                resizeStart.current = null;
                setResizing(false);
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 48 : 24;
                if (event.key === "ArrowLeft") resizePanel(panelWidth + step);
                else if (event.key === "ArrowRight") resizePanel(panelWidth - step);
                else if (event.key === "Home") resizePanel(300);
                else if (event.key === "End") resizePanel(panelMaxWidth);
                else return;
                event.preventDefault();
              }}
            />
            <aside className="sidebar" id="document-outline-panel" aria-label="Document outline">
              <div className="sidebar-heading">
                <div>
                  <h2>Document outline</h2>
                </div>
                <button
                  aria-label="Close document outline"
                  onClick={() => setPanel(false)}
                >
                  ×
                </button>
              </div>
              {outline.loading ? (
                <p role="status">Reading headings…</p>
              ) : outline.error ? (
                <p role="alert">{outline.error}</p>
              ) : !outline.entries.length ? (
                <div className="empty">
                  <strong>No headings yet.</strong>
                  <p>
                    Try the structured brief or add a Word heading.
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
                Real headings, in document order. Expand a section to see its subheadings.
              </p>
            </aside>
            </>
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
            Try renaming “Delivery plan” directly in the document. The
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
