"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { BUTTON_SECONDARY, ICON } from "./ui";

// «Копировать» — Markdown в буфер обмена, чтобы вставить в трекер или письмо
export function CopyButton({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className={BUTTON_SECONDARY} onClick={() => void copy()} aria-live="polite">
      {state === "copied" ? <Check {...ICON} /> : <Copy {...ICON} />}
      {state === "copied" ? "Скопировано" : state === "failed" ? "Не удалось скопировать" : label}
    </button>
  );
}
