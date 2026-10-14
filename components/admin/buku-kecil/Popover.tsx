// components/admin/buku-kecil/Popover.tsx
"use client";
//
// A tiny anchored popover, portalled to <body> so the table's scroll container
// can't clip it. The trigger's rect is read inside the click handler (not in an
// effect), and clicks on the trigger itself are ignored by the outside-click
// handler so the trigger can toggle it closed.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Anchor { el: HTMLElement; rect: DOMRect }

export function usePopover() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return {
    anchor,
    open:   anchor !== null,
    toggle: (e: React.MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      setAnchor((a) => (a ? null : { el, rect: el.getBoundingClientRect() }));
    },
    close: () => setAnchor(null),
  };
}

export function Popover({ anchor, onClose, width = 248, align = "left", children }: {
  anchor:   Anchor;
  onClose:  () => void;
  width?:   number;
  align?:   "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.el.contains(t)) return;
      onClose();
    };
    const key    = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const scroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [anchor, onClose]);

  const { rect } = anchor;
  const left = align === "right" ? rect.right - width : rect.left;
  const top  = rect.bottom + 6;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      className="fixed z-[70] overflow-hidden rounded-xl bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-200"
      style={{
        top, width,
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        maxHeight: Math.max(160, window.innerHeight - top - 12),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
