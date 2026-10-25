"use client";

import { useMemo, useState } from "react";
import { splitRequests } from "@/lib/split-requests";
import type { IncomingRequest } from "@/lib/types";
import { callApi, plural } from "./api";
import { BUTTON, ERROR, FILE_BUTTON, HINT, INPUT, SECTION, STEP_TITLE } from "./ui";

// Шаг 2. Входящие заявки: загрузка .txt или вставка, «Найдено N» и список до добавления

export function RequestsStep({ onAdded }: { onAdded: (requests: IncomingRequest[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useMemo(() => splitRequests(text), [text]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const texts = await Promise.all(Array.from(files).map((f) => f.text()));
    // Текст файла добавляется к уже вставленному через пустую строку — это граница заявок
    setText((current) => [current.trim(), ...texts.map((t) => t.trim())].filter(Boolean).join("\n\n"));
  }

  async function onAdd() {
    setError(null);
    setBusy(true);
    try {
      const data = await callApi<{ requests: IncomingRequest[] }>("/api/requests", {
        method: "POST",
        body: { texts: found },
      });
      onAdded(data.requests);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={SECTION} aria-labelledby="step-requests">
      <h2 id="step-requests" className={STEP_TITLE}>
        2. Входящие заявки
      </h2>
      <p className={HINT}>
        Заявки разделяются пустой строкой. Если пустых строк нет, каждая строка — отдельная заявка.
      </p>

      <label className={FILE_BUTTON}>
        Загрузить .txt
        <input
          type="file"
          multiple
          accept=".txt,text/plain"
          className="sr-only"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <textarea
        className={`${INPUT} min-h-32`}
        placeholder="Вставьте заявки из почты, чата или таблицы"
        aria-label="Текст входящих заявок"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {found.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Найдено {found.length}</p>
          <ol className="flex max-h-48 list-decimal flex-col gap-1 overflow-y-auto pl-6 text-sm">
            {found.map((item, i) => (
              <li key={i}>
                {/* line-clamp на самом li убрал бы номер пункта — поэтому внутренний span */}
                <span className="line-clamp-2 whitespace-pre-line break-words">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <button type="button" className={`${BUTTON} w-fit`} disabled={busy || found.length === 0} onClick={() => void onAdd()}>
        {found.length > 0
          ? `Добавить ${found.length} ${plural(found.length, ["заявку", "заявки", "заявок"])} в список`
          : "Добавить в список"}
      </button>

      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
