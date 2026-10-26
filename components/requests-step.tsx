"use client";

import { useMemo, useState } from "react";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { splitRequests } from "@/lib/split-requests";
import type { IncomingRequest } from "@/lib/types";
import { callApi, plural } from "./api";
import { BUTTON, ERROR, FILE_BUTTON, HINT, INPUT, SECTION, STEP_TITLE } from "./ui";

// Шаг 2. Входящие заявки: загрузка .txt или вставка, «Найдено N» и список до добавления

// Что уходит в сервис языковой модели (текст выбран владельцем, см. журнал решений, «Приватность»).
// В режиме api в сервис уходят ещё и все фрагменты документов — для эмбеддингов
const SERVICE_NOTICE = {
  local:
    "В сервис языковой модели уходят текст заявки (полностью) и найденные к ней фрагменты загруженных документов. Уберите из них личные данные и секреты, если их нельзя передавать этому сервису.",
  api: "В сервис языковой модели уходят текст заявки (полностью), найденные к ней фрагменты загруженных документов, а при загрузке — все фрагменты, чтобы рассчитать эмбеддинги. Уберите из них личные данные и секреты, если их нельзя передавать этому сервису.",
};

// Лимиты — те же, что проверяет сервер (lib/limits.ts); здесь — до отправки, чтобы сразу назвать заявку
function limitProblems(found: string[]): string[] {
  if (found.length > LIMITS.requestsPerAdd) return [LIMIT_MESSAGES.tooManyRequests(found.length)];
  return found.flatMap((item, i) => (item.length > LIMITS.requestChars ? [LIMIT_MESSAGES.requestTooLong(i + 1)] : []));
}

export function RequestsStep({
  onAdded,
  embeddingsMode,
}: {
  onAdded: (requests: IncomingRequest[]) => void;
  embeddingsMode: "local" | "api";
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useMemo(() => splitRequests(text), [text]);
  const problems = useMemo(() => limitProblems(found), [found]);

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

      {problems.length > 0 && (
        <p className={ERROR} role="alert">
          {problems.join("\n")}
        </p>
      )}

      <button
        type="button"
        className={`${BUTTON} w-fit`}
        disabled={busy || found.length === 0 || problems.length > 0}
        onClick={() => void onAdd()}
      >
        {found.length > 0
          ? `Добавить ${found.length} ${plural(found.length, ["заявку", "заявки", "заявок"])} в список`
          : "Добавить в список"}
      </button>

      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}

      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {SERVICE_NOTICE[embeddingsMode]}
      </p>
    </section>
  );
}
