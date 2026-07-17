import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon } from "./icons";
import "./App.css";

type ToolId =
  | "merge" | "split" | "extract_pages" | "compress" | "rotate"
  | "watermark" | "protect" | "unlock" | "pdf2img" | "img2pdf"
  | "office2pdf" | "pdf2docx" | "ocr" | "extract_text" | "rearrange";

type Accept = "pdf" | "image" | "office";

interface Tool {
  id: ToolId;
  name: string;
  desc: string;
  action: string;
  multi?: boolean;
  accept: Accept;
}

interface ToolGroup { label: string; color: string; tools: Tool[] }

const GROUPS: ToolGroup[] = [
  {
    label: "Organize",
    color: "#c05b2a",
    tools: [
      { id: "merge", name: "Merge", desc: "Stack several PDFs into one file, in any order you like.", action: "Merge files", multi: true, accept: "pdf" },
      { id: "rearrange", name: "Arrange", desc: "See every page. Drag to reorder, rotate, or toss the ones you don't need.", action: "Save new PDF", accept: "pdf" },
      { id: "split", name: "Split", desc: "Break a PDF apart, page by page or by custom ranges.", action: "Split it", accept: "pdf" },
      { id: "extract_pages", name: "Pick Pages", desc: "Keep only the pages you need as a fresh PDF.", action: "Extract pages", accept: "pdf" },
      { id: "rotate", name: "Rotate", desc: "Turn the whole document, or just the sideways pages.", action: "Rotate", multi: true, accept: "pdf" },
    ],
  },
  {
    label: "Shrink",
    color: "#6f7a2f",
    tools: [
      { id: "compress", name: "Compress", desc: "Squeeze the file size down. You decide how much.", action: "Compress", multi: true, accept: "pdf" },
    ],
  },
  {
    label: "Convert",
    color: "#2f7a6f",
    tools: [
      { id: "pdf2img", name: "PDF to Images", desc: "Render every page as a crisp PNG or JPG.", action: "Convert", multi: true, accept: "pdf" },
      { id: "img2pdf", name: "Images to PDF", desc: "Turn photos and scans into a single tidy PDF.", action: "Build PDF", multi: true, accept: "image" },
      { id: "office2pdf", name: "Office to PDF", desc: "Word, Excel and PowerPoint, out as clean PDFs.", action: "Convert", multi: true, accept: "office" },
      { id: "pdf2docx", name: "PDF to Word", desc: "Turn a PDF back into an editable .docx document.", action: "Convert", multi: true, accept: "pdf" },
    ],
  },
  {
    label: "Protect",
    color: "#4a5a8f",
    tools: [
      { id: "protect", name: "Lock", desc: "Add a password so only you can open it.", action: "Lock PDF", multi: true, accept: "pdf" },
      { id: "unlock", name: "Unlock", desc: "Remove the password from your own PDF.", action: "Unlock", multi: true, accept: "pdf" },
      { id: "watermark", name: "Watermark", desc: "Stamp a faint text across every page.", action: "Add watermark", multi: true, accept: "pdf" },
    ],
  },
  {
    label: "Text",
    color: "#a0741f",
    tools: [
      { id: "ocr", name: "OCR", desc: "Make scanned pages searchable and copy friendly.", action: "Run OCR", multi: true, accept: "pdf" },
      { id: "extract_text", name: "Extract Text", desc: "Pull all the text out into a .txt file.", action: "Extract", multi: true, accept: "pdf" },
    ],
  },
];

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools);
const colorOf = (id: ToolId) => GROUPS.find((g) => g.tools.some((t) => t.id === id))!.color;

const EXT: Record<Accept, string[]> = {
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg", "webp", "bmp", "tiff"],
  office: ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt"],
};

const FILTERS: Record<Accept, { name: string; extensions: string[] }[]> = {
  pdf: [{ name: "PDF", extensions: EXT.pdf }],
  image: [{ name: "Images", extensions: EXT.image }],
  office: [{ name: "Office documents", extensions: EXT.office }],
};

const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")));
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stemOf = (p: string) => {
  const n = nameOf(p);
  return n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n;
};
const extOf = (p: string) => nameOf(p).split(".").pop()?.toLowerCase() ?? "";
const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};

interface FileMeta { thumb?: string; pages?: number; size_bytes?: number; encrypted?: boolean }
interface HistoryItem { toolId: ToolId; note: string; paths: string[]; when: number }
interface Result { message: string; sub?: string; paths: string[] }

const loadHistory = (): HistoryItem[] => {
  try { return JSON.parse(localStorage.getItem("mypdf.history") ?? "[]"); } catch { return []; }
};

interface Settings { ocrLang: string; outDir: string | null; name: string }

const APP_VERSION = "0.2.0";
const REPO_URL = "https://github.com/fahmiridho07/mypdf";

const loadSettings = (): Settings => {
  try {
    return { ocrLang: "ind+eng", outDir: null, name: "", ...JSON.parse(localStorage.getItem("mypdf.settings") ?? "{}") };
  } catch {
    return { ocrLang: "ind+eng", outDir: null, name: "" };
  }
};

interface Progress { done: number; total: number }

// Tools that take one input file can also run as a batch, one file at a time.
const BATCHABLE = new Set<ToolId>([
  "compress", "rotate", "watermark", "protect", "unlock",
  "pdf2img", "ocr", "extract_text", "office2pdf", "pdf2docx",
]);

const CONFETTI = ["#c05b2a", "#6f7a2f", "#2f7a6f", "#4a5a8f", "#a0741f", "#e0a03f"];

function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 26 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 137) % 100}%`,
            background: CONFETTI[i % CONFETTI.length],
            animationDelay: `${(i % 9) * 0.06}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function CheckMark() {
  return (
    <svg className="check" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" />
      <path d="M11 18.5l5 5 9-11" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 240 180" aria-hidden>
      <defs>
        <linearGradient id="hFolder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d97a45" />
          <stop offset="1" stopColor="#b4531f" />
        </linearGradient>
        <linearGradient id="hFolderBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#96431a" />
          <stop offset="1" stopColor="#7d3814" />
        </linearGradient>
        <linearGradient id="hSheet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffdf9" />
          <stop offset="1" stopColor="#f1ead9" />
        </linearGradient>
      </defs>

      {/* backdrop blob and dots */}
      <path d="M28 96C18 56 58 18 116 14c58 4 102 26 100 70s-38 82-100 82C64 166 38 136 28 96z" fill="var(--accent-soft)" />
      <circle className="twinkle t1" cx="36" cy="48" r="4" fill="#6f7a2f" />
      <circle className="twinkle t3" cx="212" cy="126" r="5" fill="#4a5a8f" />

      {/* shadow */}
      <ellipse cx="122" cy="158" rx="66" ry="9" fill="var(--ink)" opacity="0.10" />

      {/* folder back panel */}
      <path d="M58 74q0 -10 10 -10h28l10 12h56q10 0 10 10v18H58z" fill="url(#hFolderBack)" />

      {/* documents peeking out */}
      <g className="peek p1">
        <rect x="66" y="34" width="52" height="66" rx="6" fill="url(#hSheet)" stroke="var(--line)" transform="rotate(-12 92 67)" />
        <rect x="76" y="46" width="28" height="6" rx="3" fill="#2f7a6f" transform="rotate(-12 92 67)" />
        <rect x="76" y="58" width="34" height="4" rx="2" fill="var(--ink-soft)" opacity="0.4" transform="rotate(-12 92 67)" />
        <rect x="76" y="67" width="30" height="4" rx="2" fill="var(--ink-soft)" opacity="0.4" transform="rotate(-12 92 67)" />
      </g>
      <g className="peek p2">
        <rect x="106" y="26" width="54" height="70" rx="6" fill="url(#hSheet)" stroke="var(--line)" transform="rotate(6 133 61)" />
        <rect x="115" y="38" width="36" height="26" rx="4" fill="#8fae72" opacity="0.85" transform="rotate(6 133 61)" />
        <circle cx="124" cy="46" r="4" fill="#f2d06b" transform="rotate(6 133 61)" />
        <path d="M116 60l10 -9 8 7 7 -6 10 10z" fill="#5f7a4f" transform="rotate(6 133 61)" />
        <rect x="115" y="70" width="36" height="4" rx="2" fill="var(--ink-soft)" opacity="0.4" transform="rotate(6 133 61)" />
      </g>
      <g className="peek p3">
        <rect x="152" y="44" width="42" height="54" rx="6" fill="url(#hSheet)" stroke="var(--line)" transform="rotate(15 173 71)" />
        <rect x="160" y="56" width="22" height="5" rx="2.5" fill="#a0741f" transform="rotate(15 173 71)" />
        <rect x="160" y="66" width="26" height="4" rx="2" fill="var(--ink-soft)" opacity="0.4" transform="rotate(15 173 71)" />
      </g>

      {/* folder front pocket */}
      <path d="M50 96q-2 -8 6 -8h132q8 0 6 8l-10 52q-1.5 8 -9 8H70q-8 0 -9.5 -8z" fill="url(#hFolder)" />
      <path d="M50 96q-2 -8 6 -8h132q8 0 6 8l-1.6 8H51.6z" fill="#ffffff" opacity="0.12" />
      <circle cx="122" cy="124" r="11" fill="#ffffff" opacity="0.22" />
      <path d="M117 124l4 4 7 -8" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* sparkles */}
      <path className="twinkle t2" d="M206 40l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6z" fill="var(--accent)" />
      <path className="twinkle t1" d="M46 128l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8z" fill="#f2d06b" />
    </svg>
  );
}

function DropArt() {
  return (
    <svg className="drop-art" viewBox="0 0 120 96" aria-hidden>
      <defs>
        <linearGradient id="dSheet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffdf9" />
          <stop offset="1" stopColor="#f3ecdc" />
        </linearGradient>
        <linearGradient id="dTray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--g, #b4531f)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--g, #b4531f)" />
        </linearGradient>
      </defs>

      {/* paper buddy */}
      <g className="drop-doc">
        <rect x="40" y="6" width="40" height="50" rx="7" fill="url(#dSheet)" stroke="var(--line)" />
        <path d="M68 6h5a7 7 0 017 7v5z" fill="var(--paper-sunken)" stroke="var(--line)" strokeLinejoin="round" />
        <g className="blink">
          <circle cx="53" cy="26" r="2.6" fill="var(--ink)" />
          <circle cx="67" cy="26" r="2.6" fill="var(--ink)" />
        </g>
        <path d="M54 35q6 5 12 0" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="48" cy="32" r="2.5" fill="var(--g, #b4531f)" opacity="0.25" />
        <circle cx="72" cy="32" r="2.5" fill="var(--g, #b4531f)" opacity="0.25" />
      </g>

      {/* motion hints */}
      <path className="twinkle t1" d="M28 22l1.6 3.9 3.9 1.6 -3.9 1.6 -1.6 3.9 -1.6 -3.9 -3.9 -1.6 3.9 -1.6z" fill="var(--g, #b4531f)" opacity="0.7" />
      <path className="twinkle t2" d="M92 40l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z" fill="#f2d06b" />

      {/* tray */}
      <path d="M22 66h76l-6 20q-1 5 -6 5H34q-5 0 -6 -5z" fill="url(#dTray)" />
      <path d="M22 66h76l-2 7H24z" fill="#fff" opacity="0.15" />
    </svg>
  );
}

export default function App() {
  const [tool, setToolState] = useState<Tool | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, FileMeta>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [doctor, setDoctor] = useState<Record<string, boolean> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [droppedLoose, setDroppedLoose] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batch, setBatch] = useState<{ i: number; n: number } | null>(null);
  const [welcomed, setWelcomed] = useState(() => localStorage.getItem("mypdf.welcomed") === "1");
  const [welcomeName, setWelcomeName] = useState("");

  // options
  const [splitMode, setSplitMode] = useState<"all" | "ranges">("all");
  const [ranges, setRanges] = useState("");
  const [pages, setPages] = useState("");
  const [cmpMode, setCmpMode] = useState<"printer" | "ebook" | "screen" | "custom">("ebook");
  const [cmpDpi, setCmpDpi] = useState(120);
  const [cmpQuality, setCmpQuality] = useState(70);
  const [angle, setAngle] = useState(90);
  const [wmText, setWmText] = useState("CONFIDENTIAL");
  const [wmOpacity, setWmOpacity] = useState(15);
  const [password, setPassword] = useState("");
  const [dpi, setDpi] = useState(150);
  const [imgFormat, setImgFormat] = useState("png");
  const [ocrLang, setOcrLang] = useState(loadSettings().ocrLang);

  // page organizer state
  const [pageThumbs, setPageThumbs] = useState<string[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [pageRot, setPageRot] = useState<Record<number, number>>({});
  const [pagesLoading, setPagesLoading] = useState(false);
  // Page reordering uses plain mouse events: Tauri's window level file drag
  // handler swallows HTML5 drag events on Windows, so draggable="true" never
  // fires inside the webview.
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    const up = () => setDragIdx(null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const settingsRef = useRef(showSettings);
  settingsRef.current = showSettings;

  const setTool = (t: Tool | null) => {
    setToolState(t);
    setShowSettings(false);
    setFiles([]);
    setError("");
    setResult(null);
    setPages("");
    setPassword("");
    setDroppedLoose([]);
    setPageThumbs([]);
    setPageOrder([]);
    setPageRot({});
  };

  useEffect(() => {
    invoke<Record<string, boolean>>("run_engine", { task: "doctor", params: {} })
      .then(setDoctor)
      .catch(() => setDoctor(null));
    const un = listen<{ done: number; total: number }>("engine-progress", (e) => {
      setProgress({ done: e.payload.done, total: e.payload.total });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSettings(false);
        setToolState(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { un.then((f) => f()); window.removeEventListener("keydown", onKey); };
  }, []);

  const finishWelcome = () => {
    const name = welcomeName.trim();
    if (name) saveSettings({ ...settings, name });
    localStorage.setItem("mypdf.welcomed", "1");
    setWelcomed(true);
  };

  const saveSettings = (next: Settings) => {
    setSettings(next);
    localStorage.setItem("mypdf.settings", JSON.stringify(next));
  };

  const outBase = (input: string) => settings.outDir ?? dirOf(input);
  const outFor = (input: string, suffix: string, ext = "pdf") =>
    `${outBase(input)}\\${stemOf(input)}_${suffix}.${ext}`;

  const fetchMeta = useCallback((paths: string[]) => {
    const pdfs = paths.filter((x) => extOf(x) === "pdf").slice(0, 40);
    if (pdfs.length === 0) return;
    invoke<Record<string, FileMeta>>("run_engine", { task: "thumbnails", params: { inputs: pdfs } })
      .then((all) => setMeta((prev) => ({ ...prev, ...all })))
      .catch(() => {});
  }, []);

  const loadPages = useCallback((path: string) => {
    setPagesLoading(true);
    setPageThumbs([]);
    setPageOrder([]);
    setPageRot({});
    setProgress(null);
    invoke<{ thumbs: string[]; pages: number }>("run_engine", { task: "page_thumbs", params: { input: path } })
      .then((r) => {
        setPageThumbs(r.thumbs);
        setPageOrder(r.thumbs.map((_, i) => i));
      })
      .catch((e) => setError(String(e)))
      .finally(() => { setPagesLoading(false); setProgress(null); });
  }, []);

  const addFiles = useCallback((incoming: string[], t: Tool) => {
    const valid = incoming.filter((p) => EXT[t.accept].includes(extOf(p)));
    if (valid.length === 0) return;
    setFiles((prev) => (t.multi ? [...prev, ...valid.filter((v) => !prev.includes(v))] : [valid[0]]));
    setResult(null);
    setError("");
    fetchMeta(valid);
    if (t.id === "rearrange") loadPages(valid[0]);
  }, [fetchMeta, loadPages]);

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((event) => {
      const t = event.payload.type;
      if (t === "enter" || t === "over") setDragging(true);
      else if (t === "leave") setDragging(false);
      else if (t === "drop") {
        setDragging(false);
        if (settingsRef.current) setShowSettings(false);
        const paths = event.payload.paths;
        const active = toolRef.current;
        if (active) {
          addFiles(paths, active);
        } else {
          setError("");
          setDroppedLoose(paths);
          fetchMeta(paths);
        }
      }
    });
    return () => { un.then((f) => f()); };
  }, [addFiles, fetchMeta]);

  const pickFiles = async () => {
    if (!tool) return;
    const picked = await open({ multiple: !!tool.multi, filters: FILTERS[tool.accept] });
    if (!picked) return;
    addFiles(Array.isArray(picked) ? picked : [picked], tool);
  };

  const moveFile = (i: number, dir: -1 | 1) => {
    const next = [...files];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setFiles(next);
  };

  const pushHistory = (item: HistoryItem) => {
    const next = [item, ...history].slice(0, 30);
    setHistory(next);
    localStorage.setItem("mypdf.history", JSON.stringify(next));
  };

  const paramsFor = (input: string): Record<string, unknown> => {
    if (!tool) return {};
    let params: Record<string, unknown> = {};
    switch (tool.id) {
        case "merge":
          params = { inputs: files, output: outFor(input, "merged") };
          break;
        case "split":
          params = {
            input, output_dir: `${outBase(input)}\\${stemOf(input)}_split`, mode: splitMode,
            ...(splitMode === "ranges" ? { ranges: ranges.split(";").map((s) => s.trim()).filter(Boolean) } : {}),
          };
          break;
        case "extract_pages":
          params = { input, pages, output: outFor(input, "pages") };
          break;
        case "compress":
          params = cmpMode === "custom"
            ? { input, mode: "custom", dpi: cmpDpi, quality: cmpQuality, output: outFor(input, "compressed") }
            : { input, level: cmpMode, output: outFor(input, "compressed") };
          break;
        case "rotate":
          params = { input, angle, pages: pages || undefined, output: outFor(input, "rotated") };
          break;
        case "watermark":
          params = { input, text: wmText, opacity: wmOpacity / 100, output: outFor(input, "watermarked") };
          break;
        case "protect":
          params = { input, password, output: outFor(input, "locked") };
          break;
        case "unlock":
          params = { input, password, output: outFor(input, "unlocked") };
          break;
        case "pdf2img":
          params = { input, dpi, format: imgFormat, output_dir: `${outBase(input)}\\${stemOf(input)}_images` };
          break;
        case "img2pdf":
          params = { inputs: files, output: outFor(input, "document") };
          break;
        case "office2pdf":
          params = { input, output: `${outBase(input)}\\${stemOf(input)}.pdf` };
          break;
        case "pdf2docx":
          params = { input, output: `${outBase(input)}\\${stemOf(input)}.docx` };
          break;
        case "ocr":
          params = { input, lang: ocrLang, output: outFor(input, "ocr") };
          break;
        case "extract_text":
          params = { input, output: outFor(input, "text", "txt") };
          break;
        case "rearrange":
          params = {
            input, order: pageOrder,
            rotations: Object.fromEntries(Object.entries(pageRot).filter(([, v]) => v !== 0)),
            output: outFor(input, "arranged"),
          };
          break;
      }
    return params;
  };

  const runTask = async () => {
    if (!tool || files.length === 0) return;
    setBusy(true);
    setError("");
    setResult(null);
    setProgress(null);
    const targets = BATCHABLE.has(tool.id) ? files : [files[0]];
    const allPaths: string[] = [];
    const failures: string[] = [];
    let sumBefore = 0;
    let sumAfter = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        setBatch(targets.length > 1 ? { i: i + 1, n: targets.length } : null);
        setProgress(null);
        try {
          const res = await invoke<Record<string, any>>("run_engine", {
            task: tool.id, params: paramsFor(targets[i]),
          });
          allPaths.push(...(res.outputs ?? (res.output ? [res.output] : [])));
          if (res.before) sumBefore += res.before;
          if (res.after) sumAfter += res.after;
        } catch (e) {
          failures.push(`${nameOf(targets[i])}: ${e}`);
        }
      }
      let message = "Done!";
      let sub: string | undefined;
      if (tool.id === "compress" && sumBefore > 0 && sumAfter > 0) {
        const pct = (100 * (1 - sumAfter / sumBefore)).toFixed(1);
        message = `Done! ${pct}% smaller`;
        sub = `${fmtSize(sumBefore)} down to ${fmtSize(sumAfter)}`;
      } else if (allPaths.length > 1) {
        message = `Done! ${allPaths.length} files created`;
        sub = `Saved in ${dirOf(allPaths[0])}`;
      } else if (allPaths.length === 1) {
        sub = `Saved as ${nameOf(allPaths[0])}`;
      }
      if (failures.length > 0) {
        setError(
          (allPaths.length > 0 ? `${failures.length} of ${targets.length} files failed:\n` : "") +
          failures.join("\n"));
      }
      if (allPaths.length > 0) {
        setResult({ message, sub, paths: allPaths });
        pushHistory({
          toolId: tool.id,
          note: allPaths.length > 1
            ? `${nameOf(targets[0])} (${allPaths.length} files)`
            : nameOf(allPaths[0] ?? targets[0]),
          paths: allPaths, when: Date.now(),
        });
      }
    } finally {
      setBusy(false);
      setProgress(null);
      setBatch(null);
    }
  };

  const lockedInput = tool?.id !== "unlock" && files.some((f) => meta[f]?.encrypted);

  const canRun = files.length > 0 && !busy && !lockedInput &&
    (tool?.id !== "protect" || password.length > 0) &&
    (tool?.id !== "extract_pages" || pages.trim().length > 0) &&
    (tool?.id !== "split" || splitMode === "all" || ranges.trim().length > 0) &&
    (tool?.id !== "rearrange" || pageOrder.length > 0);

  const missingFor = (t: Tool) =>
    (t.id === "office2pdf" && doctor != null && !doctor.libreoffice) ||
    (t.id === "pdf2docx" && doctor != null && !doctor.pdf2docx) ||
    (t.id === "ocr" && doctor != null && !(doctor.ocrmypdf && doctor.tesseract));

  const looseExt = droppedLoose.length > 0 ? extOf(droppedLoose[0]) : "";
  const looseAccept: Accept | "" =
    EXT.pdf.includes(looseExt) ? "pdf" : EXT.image.includes(looseExt) ? "image" : EXT.office.includes(looseExt) ? "office" : "";

  const quickPicks = ALL_TOOLS.filter((t) => ["merge", "compress", "rearrange"].includes(t.id));

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((100 * progress.done) / progress.total))
    : null;

  const pickOutDir = async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") saveSettings({ ...settings, outDir: dir });
  };

  return (
    <div className={`shell${dragging ? " dragging" : ""}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setTool(null)}>
          <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden>
            <defs>
              <linearGradient id="bm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d97a45" />
                <stop offset="1" stopColor="#a34715" />
              </linearGradient>
            </defs>
            <rect x="1" y="1" width="46" height="46" rx="12" fill="url(#bm)" />
            <g transform="rotate(8 24 24)">
              <path d="M15 11h13l6 6v20a3 3 0 01-3 3H15a3 3 0 01-3-3V14a3 3 0 013-3z" fill="#fffdf9" />
              <path d="M28 11l6 6h-6z" fill="#e2d6be" />
              <rect x="16.5" y="20" width="10" height="3" rx="1.5" fill="#b4531f" />
              <rect x="16.5" y="26" width="14" height="2.4" rx="1.2" fill="#beb4a0" />
              <rect x="16.5" y="31" width="12" height="2.4" rx="1.2" fill="#beb4a0" />
            </g>
            <circle cx="34.5" cy="34.5" r="7.5" fill="#4e804e" stroke="#a34715" strokeWidth="1.6" />
            <path d="M31 34.6l2.6 2.6 4.4-5.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 8l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1z" fill="#fff6e0" opacity="0.9" />
          </svg>
          <span className="brand-name">MyPDF</span>
        </button>
        <nav>
          {GROUPS.map((g) => (
            <div className="nav-group" key={g.label} style={{ "--g": g.color } as React.CSSProperties}>
              <span className="nav-label">{g.label}</span>
              {g.tools.map((t) => (
                <button
                  key={t.id}
                  className={`nav-item${tool?.id === t.id ? " active" : ""}`}
                  onClick={() => setTool(t)}
                >
                  <span className="nav-icon"><Icon id={t.id} size={17} /></span>
                  {t.name}
                  {missingFor(t) && <span className="nav-dot" title="Needs an extra install" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <footer className="sidebar-foot">
          <button
            className={`nav-item${showSettings ? " active" : ""}`}
            onClick={() => { setTool(null); setShowSettings(true); }}
          >
            <span className="nav-icon"><Icon id="settings" size={17} /></span>
            Settings
          </button>
          <span className="lock-note"><Icon id="shield" size={14} /> 100% offline. Files never leave this laptop.</span>
        </footer>
      </aside>

      <main className="stage">
        {showSettings ? (
          <div className="workspace">
            <header className="ws-head">
              <span className="ws-badge settings-badge"><Icon id="settings" size={26} /></span>
              <div>
                <h1>Settings</h1>
                <p>Small preferences, stored on this machine only.</p>
              </div>
            </header>

            <div className="options panelbox">
              <span className="setting-label">Your name</span>
              <label>Used only for the greeting on the home screen.
                <input
                  value={settings.name}
                  onChange={(e) => saveSettings({ ...settings, name: e.target.value })}
                  placeholder="leave empty for no name"
                  maxLength={30}
                />
              </label>

              <span className="setting-label">Default OCR language</span>
              <div className="chips">
                {([["ind+eng", "Indonesian + English"], ["ind", "Indonesian"], ["eng", "English"]] as const).map(([v, l]) => (
                  <button key={v} className={`chip${settings.ocrLang === v ? " on" : ""}`}
                    onClick={() => { saveSettings({ ...settings, ocrLang: v }); setOcrLang(v); }}>
                    {l}
                  </button>
                ))}
              </div>

              <span className="setting-label">Where results are saved</span>
              <div className="chips">
                <button className={`chip${!settings.outDir ? " on" : ""}`}
                  onClick={() => saveSettings({ ...settings, outDir: null })}>
                  Next to the original file
                </button>
                <button className={`chip${settings.outDir ? " on" : ""}`} onClick={pickOutDir}>
                  One folder for everything
                </button>
              </div>
              {settings.outDir && (
                <p className="option-hint">
                  Saving everything to <b>{settings.outDir}</b>{" "}
                  <button className="link" onClick={pickOutDir}>Change folder</button>
                </p>
              )}

              <span className="setting-label">About</span>
              <p className="option-hint">
                MyPDF {APP_VERSION}, free and open source under AGPL 3.0.
                Everything runs on this computer; the app makes no network requests.{" "}
                <button className="link" onClick={() => openUrl(REPO_URL)}>Source code on GitHub</button>
              </p>
            </div>
          </div>
        ) : !tool ? (
          <div className="home">
            <div className="hero">
              <div className="hero-copy">
                <span className="hello">
                  {settings.name ? `${greeting()}, ${settings.name} 👋` : `${greeting()} 👋`}
                </span>
                <h1>Every PDF chore,<br />handled right here.</h1>
                <p>Pick a tool on the left, or just drag files anywhere onto this window.</p>
              </div>
              <HeroArt />
            </div>

            {!welcomed && (
              <div className="welcome">
                <h2>Welcome in! Three things worth knowing:</h2>
                <ul>
                  <li><b>Everything stays on this computer.</b> No uploads, no accounts, no limits.</li>
                  <li><b>Drag files anywhere</b> onto this window and MyPDF will ask what to do with them.</li>
                  <li><b>Some tools use free helpers.</b> Compression, OCR and Office conversion get stronger when Ghostscript, Tesseract or LibreOffice are installed. The app will point you there when needed.</li>
                </ul>
                <div className="welcome-row">
                  <input
                    value={welcomeName}
                    onChange={(e) => setWelcomeName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") finishWelcome(); }}
                    placeholder="What should we call you? (optional)"
                    maxLength={30}
                  />
                  <button className="welcome-go" onClick={finishWelcome}>Let's go</button>
                </div>
              </div>
            )}

            {error && <div className="error home-error">{error}</div>}

            {droppedLoose.length > 0 && looseAccept && (
              <div className="loose">
                <div className="loose-head">
                  <strong>{droppedLoose.length} file{droppedLoose.length > 1 ? "s" : ""} ready.</strong> What should we do with them?
                  <button className="link" onClick={() => setDroppedLoose([])}>Never mind</button>
                </div>
                <div className="loose-actions">
                  {ALL_TOOLS.filter((t) => t.accept === looseAccept && !missingFor(t)).map((t) => (
                    <button key={t.id} className="chip" style={{ "--g": colorOf(t.id) } as React.CSSProperties}
                      onClick={() => {
                        const picked = droppedLoose;
                        setTool(t);
                        addFiles(picked, t);
                      }}>
                      <Icon id={t.id} size={14} /> {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="quick">
              {quickPicks.map((t, i) => (
                <button key={t.id} className="quick-card" style={{ "--g": colorOf(t.id), animationDelay: `${i * 70}ms` } as React.CSSProperties}
                  onClick={() => setTool(t)}>
                  <span className="quick-icon"><Icon id={t.id} size={24} /></span>
                  <span className="quick-name">{t.name}</span>
                  <span className="quick-desc">{t.desc}</span>
                  <span className="quick-go">Open →</span>
                </button>
              ))}
            </div>

            {history.length > 0 && (
              <section className="history">
                <div className="history-head">
                  <h2>Recent work</h2>
                  <button className="link" onClick={() => { setHistory([]); localStorage.removeItem("mypdf.history"); }}>
                    Clear
                  </button>
                </div>
                <ul>
                  {history.slice(0, 8).map((h, i) => {
                    const t = ALL_TOOLS.find((x) => x.id === h.toolId);
                    return (
                      <li key={i} style={{ animationDelay: `${i * 40}ms` }}>
                        <span className="history-icon" style={{ "--g": colorOf(h.toolId) } as React.CSSProperties}>
                          {t && <Icon id={t.id} size={14} />}
                        </span>
                        <span className="history-note" title={h.paths[0]}>{h.note}</span>
                        <span className="history-tool">{t?.name}</span>
                        {h.paths[0] && (
                          <button className="mini"
                            onClick={() => revealItemInDir(h.paths[0]).catch(() =>
                              setError(`${nameOf(h.paths[0])} is no longer there. It may have been moved or deleted.`))}>
                            Show in folder
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {doctor != null && !doctor.ghostscript && (
              <p className="notice">
                Ghostscript is not installed yet, so compression will be mild.
                Grab it from ghostscript.com and reopen the app for full power.
              </p>
            )}
          </div>
        ) : (
          <div className="workspace" key={tool.id} style={{ "--g": colorOf(tool.id) } as React.CSSProperties}>
            <header className="ws-head">
              <span className="ws-badge"><Icon id={tool.id} size={26} /></span>
              <div>
                <h1>{tool.name}</h1>
                <p>{tool.desc}</p>
              </div>
            </header>

            {missingFor(tool) && (
              <div className="notice">
                {tool.id === "ocr" ? (
                  <>This tool needs two free helpers that are not installed yet:
                    Tesseract (<code>winget install UB-Mannheim.TesseractOCR</code>) and
                    ocrmypdf (<code>pip install ocrmypdf</code>). Install them, then reopen MyPDF.</>
                ) : tool.id === "pdf2docx" ? (
                  <>This tool needs one free helper that is not installed yet:
                    <code>pip install pdf2docx</code>. Install it, then reopen MyPDF.</>
                ) : (
                  <>This tool needs LibreOffice, which is not installed yet:
                    <code>winget install TheDocumentFoundation.LibreOffice</code>. Install it, then reopen MyPDF.</>
                )}
              </div>
            )}

            <button className={`dropzone${files.length > 0 ? " compact" : ""}`} onClick={pickFiles} disabled={busy}>
              {files.length === 0 ? (
                <>
                  <DropArt />
                  <span className="dz-title">Drop files here</span>
                  <span className="dz-sub">or click to browse your folders</span>
                </>
              ) : (
                <span className="dz-title">{tool.multi ? "+ Add more files" : "Swap file"}</span>
              )}
            </button>

            {files.length > 0 && (
              <ul className="files">
                {files.map((f, i) => {
                  const m = meta[f];
                  return (
                    <li key={`${f}-${i}`} style={{ animationDelay: `${i * 45}ms` }}>
                      {m?.thumb
                        ? <img className="thumb" src={m.thumb} alt="" />
                        : <span className="thumb thumb-ph">{extOf(f).toUpperCase()}</span>}
                      <span className="file-body">
                        <span className="file-name" title={f}>{nameOf(f)}</span>
                        <span className="file-meta">
                          {m?.pages ? `${m.pages} page${m.pages > 1 ? "s" : ""}` : ""}
                          {m?.pages && m?.size_bytes ? " · " : ""}
                          {m?.size_bytes ? fmtSize(m.size_bytes) : ""}
                          {m?.encrypted ? " · locked 🔒" : ""}
                        </span>
                      </span>
                      {tool.multi && (
                        <span className="file-ops">
                          <button onClick={() => moveFile(i, -1)} disabled={i === 0} title="Move up">↑</button>
                          <button onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} title="Move down">↓</button>
                        </span>
                      )}
                      <button className="file-x" onClick={() => setFiles(files.filter((_, j) => j !== i))} title="Remove">✕</button>
                    </li>
                  );
                })}
              </ul>
            )}

            {tool.id === "rearrange" && files.length > 0 && (
              pagesLoading ? (
                <div className="pages-loading">
                  <span className="spinner tinted" /> Rendering pages…{pct != null ? ` ${pct}%` : ""}
                </div>
              ) : pageThumbs.length > 0 ? (
                <>
                  <p className="option-hint">
                    Drag pages to reorder. Use ↻ to rotate and ✕ to remove.
                    Keeping {pageOrder.length} of {pageThumbs.length} pages.
                  </p>
                  <div className="pages">
                    {pageOrder.map((pg, pos) => (
                      <div
                        key={pg}
                        className={`page-card${dragIdx === pos ? " dragging" : ""}`}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest("button")) return;
                          e.preventDefault();
                          setDragIdx(pos);
                        }}
                        onMouseEnter={() => {
                          if (dragIdx === null || dragIdx === pos) return;
                          setPageOrder((o) => {
                            const n = [...o];
                            const [moved] = n.splice(dragIdx, 1);
                            n.splice(pos, 0, moved);
                            return n;
                          });
                          setDragIdx(pos);
                        }}
                      >
                        <img src={pageThumbs[pg]} alt="" draggable={false}
                          style={{ transform: `rotate(${pageRot[pg] ?? 0}deg)` }} />
                        <span className="page-num">{pg + 1}</span>
                        <span className="page-tools">
                          <button title="Rotate" onClick={() => setPageRot((r) => ({ ...r, [pg]: ((r[pg] ?? 0) + 90) % 360 }))}>↻</button>
                          <button title="Remove" onClick={() => setPageOrder((o) => o.filter((x) => x !== pg))}>✕</button>
                        </span>
                      </div>
                    ))}
                  </div>
                  {pageOrder.length < pageThumbs.length && (
                    <button className="link left" onClick={() => { setPageOrder(pageThumbs.map((_, i) => i)); }}>
                      Bring back the removed pages
                    </button>
                  )}
                </>
              ) : null
            )}

            <div className="options">
              {tool.id === "split" && (
                <>
                  <div className="chips">
                    <button className={`chip${splitMode === "all" ? " on" : ""}`} onClick={() => setSplitMode("all")}>Every page</button>
                    <button className={`chip${splitMode === "ranges" ? " on" : ""}`} onClick={() => setSplitMode("ranges")}>Custom ranges</button>
                  </div>
                  {splitMode === "ranges" && (
                    <label>Page ranges, separated by semicolons
                      <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="e.g. 1:3; 4:10" />
                    </label>
                  )}
                </>
              )}

              {tool.id === "extract_pages" && (
                <label>Pages to keep
                  <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="e.g. 1,3,5 or 2:8" />
                </label>
              )}

              {tool.id === "compress" && (
                <>
                  <div className="chips">
                    {([["printer", "Gentle"], ["ebook", "Balanced"], ["screen", "Tiny"], ["custom", "My rules"]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${cmpMode === v ? " on" : ""}`} onClick={() => setCmpMode(v)}>{l}</button>
                    ))}
                  </div>
                  <p className="option-hint">
                    {cmpMode === "printer" && "Images at 300 dpi. Barely touched, modest savings."}
                    {cmpMode === "ebook" && "Images at 150 dpi. The safe pick for sharing and archiving."}
                    {cmpMode === "screen" && "Images at 72 dpi. Smallest output, great for email attachments."}
                    {cmpMode === "custom" && "Full control. Slide until the tradeoff feels right."}
                  </p>
                  {cmpMode === "custom" && (
                    <div className="sliders">
                      <label>Image resolution <b>{cmpDpi} dpi</b>
                        <input type="range" min={50} max={300} step={10} value={cmpDpi} onChange={(e) => setCmpDpi(Number(e.target.value))} />
                        <span className="slider-ends"><i>smaller file</i><i>sharper image</i></span>
                      </label>
                      <label>JPEG quality <b>{cmpQuality}</b>
                        <input type="range" min={20} max={95} step={5} value={cmpQuality} onChange={(e) => setCmpQuality(Number(e.target.value))} />
                        <span className="slider-ends"><i>thrifty</i><i>pretty</i></span>
                      </label>
                    </div>
                  )}
                </>
              )}

              {tool.id === "rotate" && (
                <>
                  <div className="chips">
                    {([[90, "90° right"], [180, "180°"], [270, "90° left"]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${angle === v ? " on" : ""}`} onClick={() => setAngle(v)}>{l}</button>
                    ))}
                  </div>
                  <label>Only certain pages? Leave empty for all.
                    <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="e.g. 2,4" />
                  </label>
                </>
              )}

              {tool.id === "watermark" && (
                <>
                  <label>Watermark text
                    <input value={wmText} onChange={(e) => setWmText(e.target.value)} />
                  </label>
                  <div className="sliders">
                    <label>Visibility <b>{wmOpacity}%</b>
                      <input type="range" min={5} max={60} step={5} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} />
                      <span className="slider-ends"><i>whisper</i><i>shout</i></span>
                    </label>
                  </div>
                </>
              )}

              {(tool.id === "protect" || tool.id === "unlock") && (
                <label>{tool.id === "protect" ? "New password" : "Current password"}
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder={tool.id === "unlock" ? "leave empty if there is none" : ""} />
                </label>
              )}

              {tool.id === "pdf2img" && (
                <>
                  <div className="chips">
                    {([[96, "Small"], [150, "Standard"], [300, "Sharp"]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${dpi === v ? " on" : ""}`} onClick={() => setDpi(v)}>{l} · {v} dpi</button>
                    ))}
                  </div>
                  <div className="chips">
                    {(["png", "jpg"] as const).map((f) => (
                      <button key={f} className={`chip${imgFormat === f ? " on" : ""}`} onClick={() => setImgFormat(f)}>{f.toUpperCase()}</button>
                    ))}
                  </div>
                </>
              )}

              {tool.id === "ocr" && (
                <div className="chips">
                  {([["ind+eng", "Indonesian + English"], ["ind", "Indonesian"], ["eng", "English"]] as const).map(([v, l]) => (
                    <button key={v} className={`chip${ocrLang === v ? " on" : ""}`} onClick={() => setOcrLang(v)}>{l}</button>
                  ))}
                </div>
              )}
            </div>

            {lockedInput && (
              <div className="error">
                This PDF is password protected, so tools cannot read it yet.
                Run Unlock on it first, then come back here.
              </div>
            )}

            <button
              className={`run${busy ? " working" : ""}`}
              onClick={runTask}
              disabled={!canRun}
              style={busy && pct != null ? ({ "--pct": `${pct}%` } as React.CSSProperties) : undefined}
            >
              {busy ? <span className="spinner" /> : null}
              {busy
                ? [
                    "Working on it…",
                    batch ? ` file ${batch.i} of ${batch.n}` : "",
                    pct != null ? ` ${pct}%` : "",
                  ].join("")
                : files.length > 1 && BATCHABLE.has(tool.id)
                  ? `${tool.action} · ${files.length} files`
                  : tool.action}
            </button>

            {error && <div className="error">{error}</div>}

            {result && (
              <div className="result">
                <Confetti />
                <CheckMark />
                <div className="result-text">
                  <strong>{result.message}</strong>
                  {result.sub && <span>{result.sub}</span>}
                </div>
                <div className="result-actions">
                  {result.paths[0] && (
                    <>
                      <button onClick={() => openPath(result.paths[0])}>Open file</button>
                      <button onClick={() => revealItemInDir(result.paths[0])}>Show in folder</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {dragging && (
          <div className="drag-overlay">
            <span>Drop it like it's hot 🔥</span>
          </div>
        )}
      </main>
    </div>
  );
}
