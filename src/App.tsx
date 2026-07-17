import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Icon } from "./icons";
import { Lang, STRINGS } from "./i18n";
import "./App.css";

type ToolId =
  | "merge" | "split" | "extract_pages" | "compress" | "rotate"
  | "watermark" | "protect" | "unlock" | "pdf2img" | "img2pdf"
  | "office2pdf" | "pdf2docx" | "ocr" | "extract_text" | "rearrange"
  | "page_numbers" | "set_metadata";

type Accept = "pdf" | "image" | "office";

interface Tool { id: ToolId; multi?: boolean; accept: Accept }
interface ToolGroup { key: "organize" | "shrink" | "convert" | "protect" | "text"; color: string; tools: Tool[] }

const GROUPS: ToolGroup[] = [
  {
    key: "organize", color: "#c05b2a",
    tools: [
      { id: "merge", multi: true, accept: "pdf" },
      { id: "rearrange", accept: "pdf" },
      { id: "split", accept: "pdf" },
      { id: "extract_pages", accept: "pdf" },
      { id: "rotate", multi: true, accept: "pdf" },
      { id: "page_numbers", multi: true, accept: "pdf" },
    ],
  },
  { key: "shrink", color: "#6f7a2f", tools: [{ id: "compress", multi: true, accept: "pdf" }] },
  {
    key: "convert", color: "#2f7a6f",
    tools: [
      { id: "pdf2img", multi: true, accept: "pdf" },
      { id: "img2pdf", multi: true, accept: "image" },
      { id: "office2pdf", multi: true, accept: "office" },
      { id: "pdf2docx", multi: true, accept: "pdf" },
    ],
  },
  {
    key: "protect", color: "#4a5a8f",
    tools: [
      { id: "protect", multi: true, accept: "pdf" },
      { id: "unlock", multi: true, accept: "pdf" },
      { id: "watermark", multi: true, accept: "pdf" },
    ],
  },
  {
    key: "text", color: "#a0741f",
    tools: [
      { id: "ocr", multi: true, accept: "pdf" },
      { id: "extract_text", multi: true, accept: "pdf" },
      { id: "set_metadata", multi: true, accept: "pdf" },
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
  office: [{ name: "Office", extensions: EXT.office }],
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

interface FileMeta { thumb?: string; pages?: number; size_bytes?: number; encrypted?: boolean }
interface HistoryItem { toolId: ToolId; note: string; paths: string[]; when: number }
interface Result { message: string; sub?: string; paths: string[] }
interface Progress { done: number; total: number }
interface PageItem { uid: number; pg: number; rot: number }

const loadHistory = (): HistoryItem[] => {
  try { return JSON.parse(localStorage.getItem("mypdf.history") ?? "[]"); } catch { return []; }
};

interface Settings { ocrLang: string; outDir: string | null; name: string; lang: Lang }

const APP_VERSION = "0.3.0";
const REPO_URL = "https://github.com/fahmiridho07/mypdf";
const CONCURRENCY = 3;

const loadSettings = (): Settings => {
  try {
    return { ocrLang: "ind+eng", outDir: null, name: "", lang: "en", ...JSON.parse(localStorage.getItem("mypdf.settings") ?? "{}") };
  } catch {
    return { ocrLang: "ind+eng", outDir: null, name: "", lang: "en" };
  }
};

const BATCHABLE = new Set<ToolId>([
  "compress", "rotate", "watermark", "protect", "unlock", "pdf2img",
  "ocr", "extract_text", "office2pdf", "pdf2docx", "page_numbers", "set_metadata",
]);

const CONFETTI = ["#c05b2a", "#6f7a2f", "#2f7a6f", "#4a5a8f", "#a0741f", "#e0a03f"];

function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 26 }, (_, i) => (
        <i key={i} style={{
          left: `${(i * 137) % 100}%`,
          background: CONFETTI[i % CONFETTI.length],
          animationDelay: `${(i % 9) * 0.06}s`,
          transform: `rotate(${(i * 47) % 360}deg)`,
        }} />
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
      <path d="M28 96C18 56 58 18 116 14c58 4 102 26 100 70s-38 82-100 82C64 166 38 136 28 96z" fill="var(--accent-soft)" />
      <circle className="twinkle t1" cx="36" cy="48" r="4" fill="#6f7a2f" />
      <circle className="twinkle t3" cx="212" cy="126" r="5" fill="#4a5a8f" />
      <ellipse cx="122" cy="158" rx="66" ry="9" fill="var(--ink)" opacity="0.10" />
      <path d="M58 74q0 -10 10 -10h28l10 12h56q10 0 10 10v18H58z" fill="url(#hFolderBack)" />
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
      <path d="M50 96q-2 -8 6 -8h132q8 0 6 8l-10 52q-1.5 8 -9 8H70q-8 0 -9.5 -8z" fill="url(#hFolder)" />
      <path d="M50 96q-2 -8 6 -8h132q8 0 6 8l-1.6 8H51.6z" fill="#ffffff" opacity="0.12" />
      <circle cx="122" cy="124" r="11" fill="#ffffff" opacity="0.22" />
      <path d="M117 124l4 4 7 -8" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
      <path className="twinkle t1" d="M28 22l1.6 3.9 3.9 1.6 -3.9 1.6 -1.6 3.9 -1.6 -3.9 -3.9 -1.6 3.9 -1.6z" fill="var(--g, #b4531f)" opacity="0.7" />
      <path className="twinkle t2" d="M92 40l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z" fill="#f2d06b" />
      <path d="M22 66h76l-6 20q-1 5 -6 5H34q-5 0 -6 -5z" fill="url(#dTray)" />
      <path d="M22 66h76l-2 7H24z" fill="#fff" opacity="0.15" />
    </svg>
  );
}

let nextUid = 1;

export default function App() {
  const [tool, setToolState] = useState<Tool | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, FileMeta>>({});
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
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

  const s = STRINGS[settings.lang];

  // options
  const [splitMode, setSplitMode] = useState<"all" | "ranges">("all");
  const [ranges, setRanges] = useState("");
  const [pages, setPages] = useState("");
  const [cmpMode, setCmpMode] = useState<"printer" | "ebook" | "screen" | "target" | "custom">("ebook");
  const [cmpDpi, setCmpDpi] = useState(120);
  const [cmpQuality, setCmpQuality] = useState(70);
  const [cmpTargetMB, setCmpTargetMB] = useState(2);
  const [angle, setAngle] = useState(90);
  const [wmText, setWmText] = useState("CONFIDENTIAL");
  const [wmOpacity, setWmOpacity] = useState(15);
  const [password, setPassword] = useState("");
  const [dpi, setDpi] = useState(150);
  const [imgFormat, setImgFormat] = useState("png");
  const [ocrLang, setOcrLang] = useState(loadSettings().ocrLang);
  const [pnPos, setPnPos] = useState("bottom-center");
  const [pnFmt, setPnFmt] = useState("n");
  const [pnSkip, setPnSkip] = useState(0);
  const [mdTitle, setMdTitle] = useState("");
  const [mdAuthor, setMdAuthor] = useState("");
  const [mdSubject, setMdSubject] = useState("");
  const [mdKeywords, setMdKeywords] = useState("");

  // page organizer
  const [pageThumbs, setPageThumbs] = useState<string[]>([]);
  const [pageItems, setPageItems] = useState<PageItem[]>([]);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [pagesLoading, setPagesLoading] = useState(false);
  // Mouse based reordering: the window level file drop handler swallows
  // HTML5 drag events on Windows.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const undoStack = useRef<PageItem[][]>([]);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const settingsRef = useRef(showSettings);
  settingsRef.current = showSettings;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const pageItemsRef = useRef(pageItems);
  pageItemsRef.current = pageItems;

  useEffect(() => {
    const up = () => setDragIdx(null);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", up);
    };
  }, []);

  const snapshot = () => { undoStack.current = [...undoStack.current.slice(-49), pageItemsRef.current]; };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev) setPageItems(prev);
  };

  const setTool = (t: Tool | null) => {
    setToolState(t);
    setShowSettings(false);
    setFiles([]);
    setError("");
    setInfo("");
    setResult(null);
    setPages("");
    setPassword("");
    setDroppedLoose([]);
    setPageThumbs([]);
    setPageItems([]);
    setPagesTotal(0);
    undoStack.current = [];
  };

  useEffect(() => {
    invoke<Record<string, boolean>>("run_engine", { task: "doctor", params: {} })
      .then(setDoctor)
      .catch(() => setDoctor(null));
    const un = listen<{ done: number; total: number }>("engine-progress", (e) => {
      setProgress({ done: e.payload.done, total: e.payload.total });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        setShowSettings(false);
        setToolState(null);
      }
      if (e.key.toLowerCase() === "z" && e.ctrlKey && toolRef.current?.id === "rearrange") {
        e.preventDefault();
        undo();
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
    setPageItems([]);
    setProgress(null);
    undoStack.current = [];
    invoke<{ thumbs: string[]; pages: number }>("run_engine", { task: "page_thumbs", params: { input: path } })
      .then((r) => {
        setPageThumbs(r.thumbs);
        setPagesTotal(r.thumbs.length);
        setPageItems(r.thumbs.map((_, i) => ({ uid: nextUid++, pg: i, rot: 0 })));
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
    setInfo("");
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
    const next = [{ ...item, paths: item.paths.slice(0, 5) }, ...history].slice(0, 30);
    setHistory(next);
    localStorage.setItem("mypdf.history", JSON.stringify(next));
  };

  const paramsFor = (input: string): Record<string, unknown> => {
    if (!tool) return {};
    switch (tool.id) {
      case "merge":
        return { inputs: files, output: outFor(input, "merged") };
      case "split":
        return {
          input, output_dir: `${outBase(input)}\\${stemOf(input)}_split`, mode: splitMode,
          ...(splitMode === "ranges" ? { ranges: ranges.split(";").map((x) => x.trim()).filter(Boolean) } : {}),
        };
      case "extract_pages":
        return { input, pages, output: outFor(input, "pages") };
      case "compress":
        if (cmpMode === "custom") return { input, mode: "custom", dpi: cmpDpi, quality: cmpQuality, output: outFor(input, "compressed") };
        if (cmpMode === "target") return { input, mode: "target", target_bytes: Math.round(cmpTargetMB * 1024 * 1024), output: outFor(input, "compressed") };
        return { input, level: cmpMode, output: outFor(input, "compressed") };
      case "rotate":
        return { input, angle, pages: pages || undefined, output: outFor(input, "rotated") };
      case "page_numbers":
        return { input, position: pnPos, fmt: pnFmt, skip: pnSkip, output: outFor(input, "numbered") };
      case "watermark":
        return { input, text: wmText, opacity: wmOpacity / 100, output: outFor(input, "watermarked") };
      case "protect":
        return { input, password, output: outFor(input, "locked") };
      case "unlock":
        return { input, password, output: outFor(input, "unlocked") };
      case "pdf2img":
        return { input, dpi, format: imgFormat, output_dir: `${outBase(input)}\\${stemOf(input)}_images` };
      case "img2pdf":
        return { inputs: files, output: outFor(input, "document") };
      case "office2pdf":
        return { input, output: `${outBase(input)}\\${stemOf(input)}.pdf` };
      case "pdf2docx":
        return { input, output: `${outBase(input)}\\${stemOf(input)}.docx` };
      case "ocr":
        return { input, lang: ocrLang, output: outFor(input, "ocr") };
      case "extract_text":
        return { input, output: outFor(input, "text", "txt") };
      case "set_metadata":
        return {
          input, output: outFor(input, "metadata"),
          ...(mdTitle.trim() ? { title: mdTitle.trim() } : {}),
          ...(mdAuthor.trim() ? { author: mdAuthor.trim() } : {}),
          ...(mdSubject.trim() ? { subject: mdSubject.trim() } : {}),
          ...(mdKeywords.trim() ? { keywords: mdKeywords.trim() } : {}),
        };
      case "rearrange":
        return {
          input,
          order: pageItems.map((x) => x.pg),
          rotations: pageItems.map((x) => x.rot),
          output: outFor(input, "arranged"),
        };
    }
  };

  const cancelRun = () => {
    setCancelling(true);
    invoke("cancel_engine").catch(() => {});
  };

  const runTask = async () => {
    if (!tool || files.length === 0) return;
    setBusy(true);
    setCancelling(false);
    setError("");
    setInfo("");
    setResult(null);
    setProgress(null);
    const targets = BATCHABLE.has(tool.id) ? files : [files[0]];
    const parallel = targets.length > 1;
    const allPaths: string[] = [];
    const failures: string[] = [];
    let sumBefore = 0;
    let sumAfter = 0;
    let metAll = true;
    let wasCancelled = false;
    let completed = 0;
    try {
      const queue = targets.map((f, i) => [i, f] as const);
      const worker = async () => {
        while (queue.length > 0 && !wasCancelled) {
          const [, f] = queue.shift()!;
          try {
            const res = await invoke<Record<string, any>>("run_engine", {
              task: tool.id, params: paramsFor(f),
            });
            allPaths.push(...(res.outputs ?? (res.output ? [res.output] : [])));
            if (res.before) sumBefore += res.before;
            if (res.after) sumAfter += res.after;
            if (res.met_target === false) metAll = false;
          } catch (e) {
            const msg = String(e);
            if (msg.includes("cancelled")) { wasCancelled = true; }
            else failures.push(`${nameOf(f)}: ${msg}`);
          }
          completed += 1;
          if (parallel) setBatch({ i: completed, n: targets.length });
        }
      };
      if (parallel) setBatch({ i: 0, n: targets.length });
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

      if (wasCancelled) {
        setInfo(s.cancelledNote);
      }
      let message = s.done;
      let sub: string | undefined;
      if (tool.id === "compress" && cmpMode === "target" && sumBefore > 0) {
        message = metAll ? s.fitsUnder(String(cmpTargetMB)) : s.closestGot;
        sub = s.downTo(fmtSize(sumBefore), fmtSize(sumAfter));
      } else if (tool.id === "compress" && sumBefore > 0 && sumAfter > 0) {
        const pctSaved = (100 * (1 - sumAfter / sumBefore)).toFixed(1);
        message = s.doneSmaller(pctSaved);
        sub = s.downTo(fmtSize(sumBefore), fmtSize(sumAfter));
      } else if (allPaths.length > 1) {
        message = s.filesCreated(allPaths.length);
        sub = s.savedIn(dirOf(allPaths[0]));
      } else if (allPaths.length === 1) {
        sub = s.savedAs(nameOf(allPaths[0]));
      }
      if (failures.length > 0) {
        setError((allPaths.length > 0 ? s.someFailed(failures.length, targets.length) + "\n" : "") + failures.join("\n"));
      }
      if (allPaths.length > 0) {
        setResult({ message, sub, paths: allPaths });
        pushHistory({
          toolId: tool.id,
          note: allPaths.length > 1 ? `${nameOf(targets[0])} (${allPaths.length})` : nameOf(allPaths[0] ?? targets[0]),
          paths: allPaths, when: Date.now(),
        });
      }
    } finally {
      setBusy(false);
      setCancelling(false);
      setProgress(null);
      setBatch(null);
    }
  };

  const missingFor = (t: Tool) =>
    (t.id === "office2pdf" && doctor != null && !doctor.libreoffice) ||
    (t.id === "pdf2docx" && doctor != null && !doctor.pdf2docx) ||
    (t.id === "ocr" && doctor != null && !(doctor.ocrmypdf && doctor.tesseract));

  const lockedInput = tool?.id !== "unlock" && files.some((f) => meta[f]?.encrypted);
  const needsTwo = tool != null && (tool.id === "merge" || tool.id === "img2pdf");

  const canRun = files.length > 0 && !busy && !lockedInput &&
    (tool == null || !missingFor(tool)) &&
    (!needsTwo || files.length >= 2) &&
    (tool?.id !== "protect" || password.length > 0) &&
    (tool?.id !== "extract_pages" || pages.trim().length > 0) &&
    (tool?.id !== "split" || splitMode === "all" || ranges.trim().length > 0) &&
    (tool?.id !== "rearrange" || pageItems.length > 0);

  const looseExt = droppedLoose.length > 0 ? extOf(droppedLoose[0]) : "";
  const looseAccept: Accept | "" =
    EXT.pdf.includes(looseExt) ? "pdf" : EXT.image.includes(looseExt) ? "image" : EXT.office.includes(looseExt) ? "office" : "";

  const quickPicks = ALL_TOOLS.filter((t) => ["merge", "compress", "rearrange"].includes(t.id));

  const pct = progress && progress.total > 0 && !batch
    ? Math.min(100, Math.round((100 * progress.done) / progress.total))
    : null;

  const pickOutDir = async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") saveSettings({ ...settings, outDir: dir });
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 5) return s.gNight;
    if (h < 12) return s.gMorning;
    if (h < 18) return s.gAfternoon;
    return s.gEvening;
  };

  const movePage = (pos: number, dir: -1 | 1) => {
    const j = pos + dir;
    if (j < 0 || j >= pageItems.length) return;
    snapshot();
    setPageItems((o) => {
      const n = [...o];
      [n[pos], n[j]] = [n[j], n[pos]];
      return n;
    });
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
            <div className="nav-group" key={g.key} style={{ "--g": g.color } as React.CSSProperties}>
              <span className="nav-label">{s.groups[g.key]}</span>
              {g.tools.map((t) => (
                <button key={t.id} className={`nav-item${tool?.id === t.id ? " active" : ""}`} onClick={() => setTool(t)}>
                  <span className="nav-icon"><Icon id={t.id} size={17} /></span>
                  {s.tools[t.id].name}
                  {missingFor(t) && <span className="nav-dot" title={s.needsExtra} />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <footer className="sidebar-foot">
          <button className={`nav-item${showSettings ? " active" : ""}`} onClick={() => { setTool(null); setShowSettings(true); }}>
            <span className="nav-icon"><Icon id="settings" size={17} /></span>
            {s.settings}
          </button>
          <span className="lock-note"><Icon id="shield" size={14} /> {s.offlineNote}</span>
        </footer>
      </aside>

      <main className="stage">
        {showSettings ? (
          <div className="workspace">
            <header className="ws-head">
              <span className="ws-badge settings-badge"><Icon id="settings" size={26} /></span>
              <div>
                <h1>{s.settings}</h1>
                <p>{s.settingsSub}</p>
              </div>
            </header>

            <div className="options panelbox">
              <span className="setting-label">{s.language}</span>
              <div className="chips">
                {([["en", "English"], ["id", "Bahasa Indonesia"]] as const).map(([v, l]) => (
                  <button key={v} className={`chip${settings.lang === v ? " on" : ""}`}
                    onClick={() => saveSettings({ ...settings, lang: v })}>{l}</button>
                ))}
              </div>

              <span className="setting-label">{s.yourName}</span>
              <label>{s.nameHint}
                <input value={settings.name} maxLength={30}
                  onChange={(e) => saveSettings({ ...settings, name: e.target.value })}
                  placeholder={s.namePlaceholder} />
              </label>

              <span className="setting-label">{s.ocrDefault}</span>
              <div className="chips">
                {([["ind+eng", s.langBoth], ["ind", s.langInd], ["eng", s.langEng]] as const).map(([v, l]) => (
                  <button key={v} className={`chip${settings.ocrLang === v ? " on" : ""}`}
                    onClick={() => { saveSettings({ ...settings, ocrLang: v }); setOcrLang(v); }}>{l}</button>
                ))}
              </div>

              <span className="setting-label">{s.whereSaved}</span>
              <div className="chips">
                <button className={`chip${!settings.outDir ? " on" : ""}`}
                  onClick={() => saveSettings({ ...settings, outDir: null })}>{s.nextToOriginal}</button>
                <button className={`chip${settings.outDir ? " on" : ""}`} onClick={pickOutDir}>{s.oneFolder}</button>
              </div>
              {settings.outDir && (
                <p className="option-hint">
                  {s.savingTo} <b>{settings.outDir}</b>{" "}
                  <button className="link" onClick={pickOutDir}>{s.changeFolder}</button>
                </p>
              )}

              <span className="setting-label">{s.about}</span>
              <p className="option-hint">
                {s.aboutText(APP_VERSION)}{" "}
                <button className="link" onClick={() => openUrl(REPO_URL).catch(() => {})}>{s.sourceCode}</button>
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
                <h1>{s.heroTitle1}<br />{s.heroTitle2}</h1>
                <p>{s.heroSub}</p>
              </div>
              <HeroArt />
            </div>

            {!welcomed && (
              <div className="welcome">
                <h2>{s.welcomeTitle}</h2>
                <ul>
                  <li><b>{s.w1b}</b> {s.w1}</li>
                  <li><b>{s.w2b}</b> {s.w2}</li>
                  <li><b>{s.w3b}</b> {s.w3}</li>
                </ul>
                <div className="welcome-row">
                  <input value={welcomeName} maxLength={30}
                    onChange={(e) => setWelcomeName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") finishWelcome(); }}
                    placeholder={s.welcomePlaceholder} />
                  <button className="welcome-go" onClick={finishWelcome}>{s.welcomeGo}</button>
                </div>
              </div>
            )}

            {error && <div className="error home-error">{error}</div>}

            {droppedLoose.length > 0 && looseAccept && (
              <div className="loose">
                <div className="loose-head">
                  <strong>{s.filesReady(droppedLoose.length)}</strong> {s.whatToDo}
                  <button className="link" onClick={() => setDroppedLoose([])}>{s.neverMind}</button>
                </div>
                <div className="loose-actions">
                  {ALL_TOOLS.filter((t) => t.accept === looseAccept && !missingFor(t)).map((t) => (
                    <button key={t.id} className="chip" style={{ "--g": colorOf(t.id) } as React.CSSProperties}
                      onClick={() => {
                        const picked = droppedLoose;
                        setTool(t);
                        addFiles(picked, t);
                      }}>
                      <Icon id={t.id} size={14} /> {s.tools[t.id].name}
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
                  <span className="quick-name">{s.tools[t.id].name}</span>
                  <span className="quick-desc">{s.tools[t.id].desc}</span>
                  <span className="quick-go">{s.open}</span>
                </button>
              ))}
            </div>

            {history.length > 0 && (
              <section className="history">
                <div className="history-head">
                  <h2>{s.recentWork}</h2>
                  <button className="link" onClick={() => { setHistory([]); localStorage.removeItem("mypdf.history"); }}>
                    {s.clear}
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
                        <span className="history-tool">{t ? s.tools[t.id].name : ""}</span>
                        {h.paths[0] && (
                          <button className="mini"
                            onClick={() => revealItemInDir(h.paths[0]).catch(() => setError(s.fileGone(nameOf(h.paths[0]))))}>
                            {s.showInFolder}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {doctor != null && !doctor.ghostscript && <p className="notice">{s.gsNotice}</p>}
          </div>
        ) : (
          <div className="workspace" key={tool.id} style={{ "--g": colorOf(tool.id) } as React.CSSProperties}>
            <header className="ws-head">
              <span className="ws-badge"><Icon id={tool.id} size={26} /></span>
              <div>
                <h1>{s.tools[tool.id].name}</h1>
                <p>{s.tools[tool.id].desc}</p>
              </div>
            </header>

            {missingFor(tool) && (
              <div className="notice">
                {tool.id === "ocr" ? (
                  <>{s.missingOcr} <code>winget install UB-Mannheim.TesseractOCR</code>
                    {" + "}<code>pip install ocrmypdf</code>. {s.thenReopen}</>
                ) : tool.id === "pdf2docx" ? (
                  <>{s.missingOne} <code>pip install pdf2docx</code>. {s.thenReopen}</>
                ) : (
                  <>{s.missingLibre} <code>winget install TheDocumentFoundation.LibreOffice</code>. {s.thenReopen}</>
                )}
              </div>
            )}

            <button className={`dropzone${files.length > 0 ? " compact" : ""}`} onClick={pickFiles} disabled={busy}>
              {files.length === 0 ? (
                <>
                  <DropArt />
                  <span className="dz-title">{s.dropTitle}</span>
                  <span className="dz-sub">{s.dropSub}</span>
                </>
              ) : (
                <span className="dz-title">{tool.multi ? s.addMore : s.swapFile}</span>
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
                          {m?.pages ? s.pages(m.pages) : ""}
                          {m?.pages && m?.size_bytes ? " · " : ""}
                          {m?.size_bytes ? fmtSize(m.size_bytes) : ""}
                          {m?.encrypted ? ` · ${s.lockedMeta}` : ""}
                        </span>
                      </span>
                      {tool.multi && (
                        <span className="file-ops">
                          <button onClick={() => moveFile(i, -1)} disabled={i === 0} title={s.moveUp} aria-label={s.moveUp}>↑</button>
                          <button onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} title={s.moveDown} aria-label={s.moveDown}>↓</button>
                        </span>
                      )}
                      <button className="file-x" onClick={() => setFiles(files.filter((_, j) => j !== i))} title={s.remove} aria-label={s.remove}>✕</button>
                    </li>
                  );
                })}
              </ul>
            )}

            {tool.id === "rearrange" && files.length > 0 && (
              pagesLoading ? (
                <div className="pages-loading">
                  <span className="spinner tinted" /> {s.renderingPages}{pct != null ? ` ${pct}%` : ""}
                </div>
              ) : pageItems.length > 0 || pagesTotal > 0 ? (
                <>
                  <p className="option-hint">
                    {s.arrangeHint} {s.keeping(pageItems.length, pagesTotal)}
                  </p>
                  <div className="pages">
                    {pageItems.map((item, pos) => (
                      <div
                        key={item.uid}
                        tabIndex={0}
                        className={`page-card${dragIdx === pos ? " dragging" : ""}`}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest("button")) return;
                          e.preventDefault();
                          snapshot();
                          setDragIdx(pos);
                        }}
                        onMouseEnter={() => {
                          if (dragIdx === null || dragIdx === pos) return;
                          setPageItems((o) => {
                            const n = [...o];
                            const [moved] = n.splice(dragIdx, 1);
                            n.splice(pos, 0, moved);
                            return n;
                          });
                          setDragIdx(pos);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowLeft") { e.preventDefault(); movePage(pos, -1); }
                          else if (e.key === "ArrowRight") { e.preventDefault(); movePage(pos, 1); }
                          else if (e.key === "Delete" || e.key === "Backspace") {
                            snapshot();
                            setPageItems((o) => o.filter((_, j) => j !== pos));
                          } else if (e.key.toLowerCase() === "r" && !e.ctrlKey) {
                            snapshot();
                            setPageItems((o) => o.map((x, j) => j === pos ? { ...x, rot: (x.rot + 90) % 360 } : x));
                          }
                        }}
                      >
                        <img src={pageThumbs[item.pg]} alt="" draggable={false}
                          style={{ transform: `rotate(${item.rot}deg)` }} />
                        <span className="page-num">{item.pg + 1}</span>
                        <span className="page-tools">
                          <button title={s.rotatePage} aria-label={s.rotatePage}
                            onClick={() => { snapshot(); setPageItems((o) => o.map((x, j) => j === pos ? { ...x, rot: (x.rot + 90) % 360 } : x)); }}>↻</button>
                          <button title={s.duplicatePage} aria-label={s.duplicatePage}
                            onClick={() => { snapshot(); setPageItems((o) => { const n = [...o]; n.splice(pos + 1, 0, { uid: nextUid++, pg: item.pg, rot: item.rot }); return n; }); }}>⧉</button>
                          <button title={s.remove} aria-label={s.remove}
                            onClick={() => { snapshot(); setPageItems((o) => o.filter((_, j) => j !== pos)); }}>✕</button>
                        </span>
                      </div>
                    ))}
                  </div>
                  {pageItems.length < pagesTotal && (
                    <button className="link left" onClick={() => {
                      snapshot();
                      const have = new Set(pageItems.map((x) => x.pg));
                      const missing = Array.from({ length: pagesTotal }, (_, i) => i).filter((i) => !have.has(i));
                      setPageItems((o) => [...o, ...missing.map((pg) => ({ uid: nextUid++, pg, rot: 0 }))]);
                    }}>
                      {s.bringBack}
                    </button>
                  )}
                </>
              ) : null
            )}

            <div className="options">
              {tool.id === "split" && (
                <>
                  <div className="chips">
                    <button className={`chip${splitMode === "all" ? " on" : ""}`} onClick={() => setSplitMode("all")}>{s.everyPage}</button>
                    <button className={`chip${splitMode === "ranges" ? " on" : ""}`} onClick={() => setSplitMode("ranges")}>{s.customRanges}</button>
                  </div>
                  {splitMode === "ranges" && (
                    <label>{s.rangesLabel}
                      <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder={s.rangesPh} />
                    </label>
                  )}
                </>
              )}

              {tool.id === "extract_pages" && (
                <label>{s.pagesToKeep}
                  <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder={s.pagesPh} />
                </label>
              )}

              {tool.id === "compress" && (
                <>
                  <div className="chips">
                    {([["printer", s.cGentle], ["ebook", s.cBalanced], ["screen", s.cTiny], ["target", s.cFit], ["custom", s.cCustom]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${cmpMode === v ? " on" : ""}`} onClick={() => setCmpMode(v)}>{l}</button>
                    ))}
                  </div>
                  <p className="option-hint">
                    {cmpMode === "printer" && s.cGentleHint}
                    {cmpMode === "ebook" && s.cBalancedHint}
                    {cmpMode === "screen" && s.cTinyHint}
                    {cmpMode === "target" && s.cFitHint}
                    {cmpMode === "custom" && s.cCustomHint}
                  </p>
                  {cmpMode === "target" && (
                    <label>{s.targetLabel}
                      <input type="number" min={0.1} step={0.1} value={cmpTargetMB}
                        onChange={(e) => setCmpTargetMB(Math.max(0.1, Number(e.target.value) || 2))} />
                    </label>
                  )}
                  {cmpMode === "custom" && (
                    <div className="sliders">
                      <label>{s.imageRes} <b>{cmpDpi} dpi</b>
                        <input type="range" min={50} max={300} step={10} value={cmpDpi} onChange={(e) => setCmpDpi(Number(e.target.value))} />
                        <span className="slider-ends"><i>{s.smallerFile}</i><i>{s.sharper}</i></span>
                      </label>
                      <label>{s.jpegQ} <b>{cmpQuality}</b>
                        <input type="range" min={20} max={95} step={5} value={cmpQuality} onChange={(e) => setCmpQuality(Number(e.target.value))} />
                        <span className="slider-ends"><i>{s.thrifty}</i><i>{s.pretty}</i></span>
                      </label>
                    </div>
                  )}
                </>
              )}

              {tool.id === "rotate" && (
                <>
                  <div className="chips">
                    {([[90, s.rRight], [180, "180°"], [270, s.rLeft]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${angle === v ? " on" : ""}`} onClick={() => setAngle(v)}>{l}</button>
                    ))}
                  </div>
                  <label>{s.onlyPages}
                    <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder={s.onlyPagesPh} />
                  </label>
                </>
              )}

              {tool.id === "page_numbers" && (
                <>
                  <span className="setting-label">{s.pnPosition}</span>
                  <div className="chips">
                    {([["bottom-center", s.pnBC], ["bottom-right", s.pnBR], ["bottom-left", s.pnBL], ["top-right", s.pnTR], ["top-left", s.pnTL]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${pnPos === v ? " on" : ""}`} onClick={() => setPnPos(v)}>{l}</button>
                    ))}
                  </div>
                  <span className="setting-label">{s.pnFormat}</span>
                  <div className="chips">
                    {([["n", s.pnN], ["page-n", s.pnPageN], ["n-of-total", s.pnNofT]] as const).map(([v, l]) => (
                      <button key={v} className={`chip${pnFmt === v ? " on" : ""}`} onClick={() => setPnFmt(v)}>{l}</button>
                    ))}
                  </div>
                  <label>{s.pnSkip}
                    <input type="number" min={0} max={20} value={pnSkip}
                      onChange={(e) => setPnSkip(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
                  </label>
                </>
              )}

              {tool.id === "watermark" && (
                <>
                  <label>{s.wmText}
                    <input value={wmText} onChange={(e) => setWmText(e.target.value)} />
                  </label>
                  <div className="sliders">
                    <label>{s.visibility} <b>{wmOpacity}%</b>
                      <input type="range" min={5} max={60} step={5} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} />
                      <span className="slider-ends"><i>{s.whisper}</i><i>{s.shout}</i></span>
                    </label>
                  </div>
                </>
              )}

              {(tool.id === "protect" || tool.id === "unlock") && (
                <label>{tool.id === "protect" ? s.newPassword : s.currentPassword}
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder={tool.id === "unlock" ? s.noPassPh : ""} />
                </label>
              )}

              {tool.id === "pdf2img" && (
                <>
                  <div className="chips">
                    {([[96, s.iSmall], [150, s.iStandard], [300, s.iSharp]] as const).map(([v, l]) => (
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
                  {([["ind+eng", s.langBoth], ["ind", s.langInd], ["eng", s.langEng]] as const).map(([v, l]) => (
                    <button key={v} className={`chip${ocrLang === v ? " on" : ""}`} onClick={() => setOcrLang(v)}>{l}</button>
                  ))}
                </div>
              )}

              {tool.id === "set_metadata" && (
                <>
                  <label>{s.mdTitle}
                    <input value={mdTitle} onChange={(e) => setMdTitle(e.target.value)} />
                  </label>
                  <label>{s.mdAuthor}
                    <input value={mdAuthor} onChange={(e) => setMdAuthor(e.target.value)} />
                  </label>
                  <label>{s.mdSubject}
                    <input value={mdSubject} onChange={(e) => setMdSubject(e.target.value)} />
                  </label>
                  <label>{s.mdKeywords}
                    <input value={mdKeywords} onChange={(e) => setMdKeywords(e.target.value)} />
                  </label>
                  <p className="option-hint">{s.mdHint}</p>
                </>
              )}
            </div>

            {lockedInput && <div className="error">{s.lockedError}</div>}
            {needsTwo && files.length === 1 && <p className="option-hint">{s.addOneMore}</p>}

            <div className="run-row">
              <button
                className={`run${busy ? " working" : ""}`}
                onClick={runTask}
                disabled={!canRun}
                style={busy && pct != null ? ({ "--pct": `${pct}%` } as React.CSSProperties) : undefined}
              >
                {busy ? <span className="spinner" /> : null}
                {busy
                  ? [s.working, batch ? s.fileOf(batch.i, batch.n) : "", pct != null ? ` ${pct}%` : ""].join("")
                  : files.length > 1 && BATCHABLE.has(tool.id)
                    ? `${s.tools[tool.id].action}${s.batchSuffix(files.length)}`
                    : s.tools[tool.id].action}
              </button>
              {busy && (
                <button className="cancel" onClick={cancelRun} disabled={cancelling}>
                  {s.cancel}
                </button>
              )}
            </div>

            {info && <div className="notice">{info}</div>}
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
                      <button onClick={() => openPath(result.paths[0]).catch((e) => setError(s.couldNotOpen(String(e))))}>
                        {s.openFile}
                      </button>
                      <button onClick={() => revealItemInDir(result.paths[0]).catch((e) => setError(s.couldNotFolder(String(e))))}>
                        {s.showInFolder}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {dragging && (
          <div className="drag-overlay">
            <span>{settings.lang === "id" ? "Lepaskan di sini 🔥" : "Drop it like it's hot 🔥"}</span>
          </div>
        )}
      </main>
    </div>
  );
}
