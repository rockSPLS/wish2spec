"use client";

import { useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import { callApi, plural } from "./api";
import { BUTTON_SECONDARY, ERROR, FILE_BUTTON, HINT, INPUT, SECTION, STEP_TITLE } from "./ui";

type Upload = { name: string; format: "md" | "txt"; text: string };

// Шаг 1. Документация системы: загрузка .md и .txt, вставка текста, список и удаление

export function DocumentsStep({
  documents,
  onChange,
}: {
  documents: DocumentSummary[];
  onChange: (documents: DocumentSummary[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");

  // Возвращает текст ошибки или null; показывает его вызывающая функция — вместе с другими сообщениями
  async function upload(items: Upload[]): Promise<string | null> {
    setError(null);
    setBusy(
      "Индексирую документы… В первый раз скачивается модель эмбеддингов (около 135 МБ), это может занять пару минут.",
    );
    try {
      const data = await callApi<{ documents: DocumentSummary[] }>("/api/documents", {
        method: "POST",
        body: { documents: items },
      });
      onChange(data.documents);
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      setBusy(null);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const items: Upload[] = [];
    const skipped: string[] = [];
    for (const file of Array.from(files)) {
      const match = /^(.*)\.(md|markdown|txt)$/i.exec(file.name);
      if (!match) {
        skipped.push(file.name);
        continue;
      }
      items.push({
        name: match[1],
        format: match[2].toLowerCase() === "txt" ? "txt" : "md",
        text: await file.text(),
      });
    }
    const problems: string[] = [];
    if (items.length > 0) {
      const uploadError = await upload(items);
      if (uploadError) problems.push(uploadError);
    }
    if (skipped.length > 0) {
      problems.push(`Пропущены файлы не в формате .md или .txt: ${skipped.join(", ")}.`);
    }
    setError(problems.length > 0 ? problems.join("\n") : null);
  }

  async function onPaste() {
    // Вставленный текст разбирается как Markdown: если заголовков нет, он режется по абзацам, как .txt
    const uploadError = await upload([{ name: pasteName.trim(), format: "md", text: pasteText }]);
    setError(uploadError);
    if (!uploadError) {
      setPasteName("");
      setPasteText("");
    }
  }

  async function onDelete(name: string) {
    if (!window.confirm(`Удалить документ «${name}»?`)) return;
    setError(null);
    try {
      const data = await callApi<{ documents: DocumentSummary[] }>("/api/documents", {
        method: "DELETE",
        body: { name },
      });
      onChange(data.documents);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className={SECTION} aria-labelledby="step-documents">
      <h2 id="step-documents" className={STEP_TITLE}>
        1. Документация системы
      </h2>
      <p className={HINT}>
        Справка, прежние ТЗ, список задач, глоссарий — файлы .md и .txt. Документ с тем же названием
        заменяется.
      </p>

      <label className={`${FILE_BUTTON} ${busy ? "pointer-events-none opacity-40" : ""}`}>
        Загрузить файлы
        <input
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="sr-only"
          disabled={!!busy}
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <details className="text-sm">
        <summary className="cursor-pointer select-none">Вставить текст</summary>
        <div className="mt-2 flex flex-col gap-2">
          <input
            className={INPUT}
            placeholder="Название документа"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
          />
          <textarea
            className={`${INPUT} min-h-32`}
            placeholder="Текст документа. Заголовки Markdown (#, ##) помогут разбить его на разделы."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button
            type="button"
            className={`${BUTTON_SECONDARY} w-fit`}
            disabled={!!busy || !pasteName.trim() || !pasteText.trim()}
            onClick={() => void onPaste()}
          >
            Добавить документ
          </button>
        </div>
      </details>

      {busy && (
        <p className={HINT} role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}

      {documents.length === 0 ? (
        <p className={HINT}>Документов пока нет.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {documents.map((d) => (
            <li key={d.name} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 break-words">{d.name}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {d.chunkCount} {plural(d.chunkCount, ["фрагмент", "фрагмента", "фрагментов"])}
                </span>
                <button
                  type="button"
                  className="text-red-700 hover:underline disabled:opacity-40 dark:text-red-400"
                  disabled={!!busy}
                  onClick={() => void onDelete(d.name)}
                >
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
