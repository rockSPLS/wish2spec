"use client";

import { useEffect, useRef, useState } from "react";
import type { IncomingRequest } from "@/lib/types";
import { plural } from "./api";
import { RequestCard, VerdictLabel, type RunState } from "./request-card";
import { BUTTON, HINT, SECTION, STEP_TITLE } from "./ui";

// Шаг 3. Результат обработки: список заявок слева (около 40 %), карточка выбранной — справа.
// На узком экране всё в один столбец, карточка под списком.

function Status({ request, runState }: { request: IncomingRequest; runState?: RunState }) {
  const base = "inline-block rounded px-2 py-0.5 text-xs font-medium";
  if (runState === "processing") return <span className={`${base} bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200`}>Обрабатывается…</span>;
  if (runState === "queued") return <span className={`${base} text-zinc-600 dark:text-zinc-400`}>В очереди</span>;
  if (request.result) return <VerdictLabel result={request.result} />;
  if (request.status === "error") return <span className={`${base} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200`}>Ошибка</span>;
  return <span className={`${base} text-zinc-600 dark:text-zinc-400`}>Не обработана</span>;
}

export function ResultsStep({
  requests,
  runStates,
  selectedId,
  onSelect,
  onProcess,
  running,
  hasDocuments,
}: {
  requests: IncomingRequest[];
  runStates: Record<string, RunState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onProcess: () => void;
  running: boolean;
  hasDocuments: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const unprocessed = requests.filter((r) => r.status !== "done").length;
  const selected = requests.find((r) => r.id === selectedId) ?? null;

  // Счётчик кликов: прокрутка нужна и при повторном клике по уже выбранной строке
  const [scrollRequest, setScrollRequest] = useState(0);

  function select(id: string) {
    onSelect(id);
    setScrollRequest((n) => n + 1);
  }

  // На узком экране карточка под списком — после клика прокручиваем к ней. Уже после отрисовки:
  // пока карточка не показана, страница короче, и прокрутка упёрлась бы в её конец.
  // Плавно, если в системе не включено «уменьшить движение»
  useEffect(() => {
    if (scrollRequest === 0 || window.matchMedia("(min-width: 1024px)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [scrollRequest]);

  let hint: string | null = null;
  if (!hasDocuments) hint = "Сначала загрузите документацию системы.";
  else if (requests.length === 0) hint = "Добавьте входящие заявки в шаге 2.";
  else if (unprocessed === 0 && !running) hint = "Все заявки обработаны.";

  return (
    <section className={SECTION} aria-labelledby="step-results">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="step-results" className={STEP_TITLE}>
          3. Результат обработки
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {hint && <span className={HINT}>{hint}</span>}
          <button
            type="button"
            className={BUTTON}
            disabled={running || unprocessed === 0 || !hasDocuments}
            onClick={onProcess}
          >
            {running
              ? "Обрабатываю…"
              : unprocessed > 0
                ? `Обработать ${unprocessed} ${plural(unprocessed, ["заявку", "заявки", "заявок"])}`
                : "Обработать"}
          </button>
        </div>
      </div>

      {requests.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <ol className="flex flex-col divide-y divide-zinc-200 overflow-y-auto rounded-md border border-zinc-200 lg:max-h-[75vh] dark:divide-zinc-800 dark:border-zinc-800">
            {requests.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={r.id === selectedId ? "true" : undefined}
                  className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                    r.id === selectedId ? "bg-zinc-100 dark:bg-zinc-800" : ""
                  }`}
                  onClick={() => select(r.id)}
                >
                  <span className="w-6 shrink-0 text-right text-zinc-500">{r.number}</span>
                  <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line break-words">{r.text}</span>
                  <span className="shrink-0">
                    <Status request={r} runState={runStates[r.id]} />
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div
            ref={cardRef}
            className="scroll-mt-4 overflow-y-auto rounded-md border border-zinc-200 p-4 lg:max-h-[75vh] dark:border-zinc-800"
          >
            <RequestCard request={selected} runState={selected ? runStates[selected.id] : undefined} />
          </div>
        </div>
      )}
    </section>
  );
}
