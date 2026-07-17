import type { JSX } from "react";

// Hand drawn icon set for MyPDF. One visual language: 1.7px round strokes,
// a recurring "sheet of paper" motif, and a soft duotone fill that inherits
// the tool group's color via currentColor.

export type IconId =
  | "merge" | "split" | "extract_pages" | "compress" | "rotate"
  | "watermark" | "protect" | "unlock" | "pdf2img" | "img2pdf"
  | "office2pdf" | "pdf2docx" | "ocr" | "extract_text" | "rearrange"
  | "settings" | "shield";

const soft = { fill: "currentColor", fillOpacity: 0.16 } as const;
const dot = { fill: "currentColor", stroke: "none" } as const;

const GLYPHS: Record<IconId, JSX.Element> = {
  merge: (
    <>
      <rect x="3" y="3" width="9.5" height="13" rx="2" />
      <rect x="11.5" y="8" width="9.5" height="13" rx="2" {...soft} />
    </>
  ),
  rearrange: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" {...soft} />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" {...soft} />
      <rect x="13.9" y="13" width="7" height="7" rx="1.6" transform="rotate(10 17.4 16.5)" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="3.5" width="6.8" height="13" rx="1.8" />
      <rect x="14.2" y="7.5" width="6.8" height="13" rx="1.8" {...soft} />
      <path d="M12 3.5v17.5" strokeDasharray="2.4 3.1" />
    </>
  ),
  extract_pages: (
    <>
      <path d="M14.5 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14.5 3v5h5" {...soft} />
      <path d="M8.7 13.4l2.4 2.4 4.4-5.2" />
    </>
  ),
  compress: (
    <>
      <path d="M9 2.6l3 3 3-3" />
      <path d="M9 21.4l3-3 3 3" />
      <rect x="4.5" y="9.2" width="15" height="5.6" rx="1.8" {...soft} />
      <path d="M8 12h8" />
    </>
  ),
  rotate: (
    <>
      <path d="M18.6 2.8v3.6H15" />
      <path d="M18.5 6.3A8 8 0 0 0 4.8 8.6" />
      <rect x="6.5" y="10.2" width="11" height="11" rx="2" {...soft} />
    </>
  ),
  pdf2img: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.7" {...dot} />
      <path d="M3.5 17.2l5-4.6 3.4 3 3.6-3.6 5 4.6" {...soft} />
    </>
  ),
  img2pdf: (
    <>
      <rect x="3" y="3.5" width="9.5" height="8" rx="1.8" />
      <path d="M3.6 10.2l2.6-2.4 1.9 1.7 1.6-1.4 2.2 2" />
      <path d="M15 6.8h3.4M16.8 5l1.8 1.8-1.8 1.8" />
      <rect x="12" y="11.5" width="9" height="10" rx="2" {...soft} />
    </>
  ),
  office2pdf: (
    <>
      <rect x="3.5" y="3.5" width="8.6" height="11" rx="1.8" />
      <path d="M5.9 6.8l1 4.4 1-3 1 3 1-4.4" />
      <path d="M14.2 7.4h3.2M15.8 5.7l1.7 1.7-1.7 1.7" />
      <rect x="13" y="11.5" width="8" height="10" rx="2" {...soft} />
    </>
  ),
  pdf2docx: (
    <>
      <rect x="3.5" y="3.5" width="8.6" height="11" rx="1.8" {...soft} />
      <path d="M14.2 7.4h3.2M15.8 5.7l1.7 1.7-1.7 1.7" />
      <rect x="13" y="11.5" width="8" height="10" rx="2" />
      <path d="M14.9 14.6l1 4.4 1-3 1 3 1-4.4" />
    </>
  ),
  protect: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" {...soft} />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="14.8" r="1.4" {...dot} />
      <path d="M12 16.1v1.7" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" {...soft} />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
      <circle cx="12" cy="14.8" r="1.4" {...dot} />
      <path d="M12 16.1v1.7" />
    </>
  ),
  watermark: (
    <>
      <path d="M12 3.2s5.7 6.3 5.7 10.3a5.7 5.7 0 0 1-11.4 0C6.3 9.5 12 3.2 12 3.2z" {...soft} />
      <path d="M9.3 13.8a3 3 0 0 0 2.1 2.7" />
    </>
  ),
  ocr: (
    <>
      <circle cx="10.5" cy="10.5" r="6.7" {...soft} />
      <path d="M15.6 15.6l5 5" />
      <path d="M7.6 8.9h5.8M7.6 12.1h3.8" />
    </>
  ),
  extract_text: (
    <>
      <rect x="3.5" y="3" width="11.5" height="18" rx="2.4" />
      <path d="M6.5 7.5h5.5M6.5 11h5.5M6.5 14.5h3" />
      <path d="M13.5 17.8h6.8M17.6 15.2l2.7 2.6-2.7 2.6" {...soft} />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20M4 12h2.5M9.5 12H20M4 17h10M18.5 17H20" />
      <circle cx="15" cy="7" r="2.1" {...soft} />
      <circle cx="7" cy="12" r="2.1" {...soft} />
      <circle cx="16.2" cy="17" r="2.1" {...soft} />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 2.6v5.6c0 4.4-2.9 7.6-7 9.3-4.1-1.7-7-4.9-7-9.3V5.6z" {...soft} />
      <path d="M9.1 11.9l2.2 2.2 3.8-4.4" />
    </>
  ),
};

export function Icon({ id, size = 18 }: { id: IconId; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[id]}
    </svg>
  );
}
