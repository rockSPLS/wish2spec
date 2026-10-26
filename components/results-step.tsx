"use client";

import { useEffect, useRef, useState } from "react";
import { VERDICTS, type IncomingRequest } from "@/lib/types";
import { currentReview, currentVerdict, REVIEW_MARK, REVIEW_STYLE, verdictLabel, VERDICT_STYLE } from "@/lib/verdicts";
import { plural } from "./api";
import { RequestCard, ReviewMark, VerdictLabel, type CardActions, type RunState } from "./request-card";
import { BUTTON, ERROR, HINT, SECTION, STEP_TITLE } from "./ui";

// Шаг 3. Результат обработки: счётчики, список заявок слева (около 40 %), карточка выбранной — справа.
// На узком экране всё в один столбец, карточка под списком.

const BADGE = "inline-block rounded px-2 py-0.5 text-xs font-medium";

function Status({ request, runState }: { request: IncomingRequest; runState?: RunState }) {
  if (runState === "processing") return <span className={`${BADGE} bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200`}>Обрабатывается…</span>;
  if (runState === "queued") return <span className={`${BADGE} text-zinc-600 dark:text-zinc-400`}>В очереди</span>;
  const verdict = currentVerdict(request);
  if (verdict) {
    // Отметка «Проверьте» — под ярлыком, чтобы в списке было видно, какие заявки перепроверить
    return (
      <span className="flex flex-col items-end gap-1">
        <VerdictLabel verdict={verdict.verdict} taskNumber={verdict.taskNumber} />
        {currentReview(request).length > 0 && <ReviewMark />}
      </span>
    );
  }
  if (request.status === "error") return <span className={`${BADGE} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200`}>Ошибка</span>;
  return <span className={`${BADGE} text-zinc-600 dark:text-zinc-400`}>Не обработана</span>;
}

// Счётчики над списком — картина всей пачки. Вердикт и отметка — те, что видит аналитик (с его правками)
function Counters({ requests }: { requests: IncomingRequest[] }) {
  const verdicts = requests.map(currentVerdict);
  const review = requests.filter((r) => currentReview(r).length > 0).length;
  const unprocessed = verdicts.filter((v) => v === null).length;
  return (
    <ul className="flex flex-wrap items-center gap-2 text-sm" aria-label="Счётчики заявок">
      <li className="font-medium">Всего: {requests.length}</li>
      {VERDICTS.map((v) => (
        <li key={v} className={`${BADGE} ${VERDICT_STYLE[v]}`}>
          {verdictLabel(v, null)}: {verdicts.filter((c) => c?.verdict === v).length}
        </li>
      ))}
      <li className={`${BADGE} ${REVIEW_STYLE}`}>
        {REVIEW_MARK}: {review}
      </li>
      {unprocessed > 0 && <li className={`${BADGE} text-zinc-600 dark:text-zinc-400`}>Без результата: {unprocessed}</li>}
    </ul>
  );
}

export function ResultsStep({
  requests,
  runStates,
  selectedId,
  onSelect,
  onProcess,
  onClear,
  running,
  busy,
  hasDocuments,
  actions,
}: {
  requests: IncomingRequest[];
  runStates: Record<string, RunState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onProcess: () => void;
  onClear: () => Promise<string | null>;
  running: boolean;
  busy: boolean;
  hasDocuments: boolean;
  actions: CardActions;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [clearError, setClearError] = useState<string | null>(null);
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
            disabled={busy || unprocessed === 0 || !hasDocuments}
            onClick={onProcess}
          >
            {running
              ? "Обрабатываю…"
              : unprocessed > 0
                ? `Обработать ${unprocessed} ${plural(unprocessed, ["заявку", "заявки", "заявок"])}`
                : "Обработать"}
          </button>
          {requests.length > 0 && (
            <button
              type="button"
              className="text-sm text-red-700 hover:underline disabled:opacity-40 dark:text-red-400"
              disabled={busy}
              onClick={() => {
                setClearError(null);
                void onClear().then(setClearError);
              }}
            >
              Очистить список
            </button>
          )}
        </div>
      </div>

      {clearError && (
        <p className={ERROR} role="alert">
          {clearError}
        </p>
      )}

      {requests.length > 0 && <Counters requests={requests} />}

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
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 whitespace-pre-line break-words">{r.text}</span>
                    {/* Ошибка — понятным текстом прямо в строке; «Повторить» — в карточке */}
                    {r.status === "error" && r.error && !runStates[r.id] && (
                      <span className="line-clamp-2 break-words text-xs text-red-700 dark:text-red-400">{r.error}</span>
                    )}
                  </span>
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
            <RequestCard
              request={selected}
              runState={selected ? runStates[selected.id] : undefined}
              busy={busy}
              actions={actions}
            />
          </div>
        </div>
      )}
    </section>
  );
}
