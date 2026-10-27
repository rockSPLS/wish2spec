"use client";

import { ArrowRight, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VERDICTS, type IncomingRequest, type Verdict } from "@/lib/types";
import { currentReview, currentVerdict, REVIEW_MARK, REVIEW_STYLE, verdictLabel, VERDICT_STYLE } from "@/lib/verdicts";
import { plural } from "./api";
import { Hint } from "./hint";
import { Spinner } from "./progress";
import { RequestCard, ReviewMark, VerdictLabel, type CardActions, type RunState } from "./request-card";
import { BUSY_HINT, BUTTON, DANGER_LINK, ERROR, HINT, ICON, LINK_BUTTON, PANEL, SECTION, STEP_NUMBER, STEP_TITLE } from "./ui";

// Шаг 3. Результат обработки: счётчики, список заявок слева (около 40 %), карточка выбранной — справа.
// На узком экране всё в один столбец, карточка под списком.

const BADGE = "inline-block rounded px-2 py-0.5 text-xs font-medium";

function Status({ request, runState }: { request: IncomingRequest; runState?: RunState }) {
  if (runState === "processing") {
    return (
      <span className={`${BADGE} bg-sky-50 text-sky-800 motion-safe:animate-pulse dark:bg-sky-950 dark:text-sky-200`}>
        Обрабатывается…
      </span>
    );
  }
  if (runState === "queued") return <span className={`${BADGE} text-muted`}>В очереди</span>;
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
  return <span className={`${BADGE} text-muted`}>Не обработана</span>;
}

// Фильтр списка по счётчику — один за раз; null — все заявки
type Filter = { kind: "verdict"; verdict: Verdict } | { kind: "review" } | { kind: "unprocessed" } | null;

const filterKey = (f: Filter) => (f === null ? "all" : f.kind === "verdict" ? f.verdict : f.kind);

// Вердикт и отметка — те, что видит аналитик (с его правками), как в счётчиках
function matches(request: IncomingRequest, filter: Filter): boolean {
  if (!filter) return true;
  if (filter.kind === "verdict") return currentVerdict(request)?.verdict === filter.verdict;
  if (filter.kind === "review") return currentReview(request).length > 0;
  return currentVerdict(request) === null;
}

function emptyFilterText(filter: NonNullable<Filter>): string {
  if (filter.kind === "verdict") return `Заявок с вердиктом «${verdictLabel(filter.verdict, null)}» нет.`;
  if (filter.kind === "review") return `Заявок с отметкой «${REVIEW_MARK}» нет.`;
  return "Заявок без результата нет.";
}

// Выбранный фильтр — рамка цвета текста вокруг; тонкая рамка при наведении — что счётчик нажимается
const COUNTER = `${BADGE} cursor-pointer hover:ring-1 hover:ring-muted aria-pressed:ring-2 aria-pressed:ring-foreground motion-safe:transition-shadow`;

// Счётчики над списком — картина всей пачки и фильтры. Нажатие оставляет в списке только эти заявки,
// повторное нажатие или «Всего» снимает фильтр
function Counters({
  requests,
  filter,
  onFilter,
}: {
  requests: IncomingRequest[];
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const verdicts = requests.map(currentVerdict);
  const review = requests.filter((r) => currentReview(r).length > 0).length;
  const unprocessed = verdicts.filter((v) => v === null).length;

  function counter(target: NonNullable<Filter>, className: string, text: string) {
    const pressed = filterKey(filter) === filterKey(target);
    return (
      <li key={filterKey(target)}>
        <button
          type="button"
          aria-pressed={pressed}
          className={`${COUNTER} ${className}`}
          onClick={() => onFilter(pressed ? null : target)}
        >
          {text}
        </button>
      </li>
    );
  }

  return (
    <ul className="flex flex-wrap items-center gap-2 text-sm" aria-label="Счётчики заявок — фильтры списка">
      {/* «Всего» — не фильтр, а «показать все»: без рамки нажатия, иначе кажется, что фильтр уже выбран */}
      <li>
        <button
          type="button"
          className={`${COUNTER} border border-line-strong`}
          onClick={() => onFilter(null)}
        >
          Всего: {requests.length}
        </button>
      </li>
      {VERDICTS.map((v) =>
        counter(
          { kind: "verdict", verdict: v },
          VERDICT_STYLE[v],
          `${verdictLabel(v, null)}: ${verdicts.filter((c) => c?.verdict === v).length}`,
        ),
      )}
      {counter({ kind: "review" }, REVIEW_STYLE, `${REVIEW_MARK}: ${review}`)}
      {/* «Без результата» — если такие есть или выбран этот фильтр: иначе счётчик пропал бы из-под нажатия */}
      {(unprocessed > 0 || filter?.kind === "unprocessed") &&
        counter({ kind: "unprocessed" }, "border border-dashed border-line-strong text-muted", `Без результата: ${unprocessed}`)}
    </ul>
  );
}

// Пустой шаг: что здесь появится
function EmptyResults() {
  const chain = ["Документы", "Заявки", "Вердикт с источниками"];
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
      <ol className="flex flex-wrap items-center justify-center gap-2 text-sm font-medium">
        {chain.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="rounded-full bg-subtle px-3 py-1">{step}</span>
            {i < chain.length - 1 && <ArrowRight size={16} aria-hidden className="text-muted" />}
          </li>
        ))}
      </ol>
      <p className={HINT}>Здесь появятся заявки с вердиктами. Для новых Wish2Spec подготовит основу ТЗ.</p>
    </div>
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
  const [filter, setFilter] = useState<Filter>(null);
  // Пока выбран фильтр, список не становится ниже, чем был без фильтра: иначе страница укорачивается
  // и прокрутка прыгает вверх. Высота запоминается при первом нажатии на фильтр
  const gridRef = useRef<HTMLDivElement>(null);
  const [listMinHeight, setListMinHeight] = useState<number | null>(null);

  // Список опустел («Очистить список») — фильтр и запомненная высота сбрасываются: иначе новые заявки
  // открылись бы отфильтрованными. Состояние меняется прямо при отрисовке, когда меняется пустота списка
  const empty = requests.length === 0;
  const [wasEmpty, setWasEmpty] = useState(empty);
  if (empty !== wasEmpty) {
    setWasEmpty(empty);
    if (empty) {
      setFilter(null);
      setListMinHeight(null);
    }
  }

  function applyFilter(next: Filter) {
    if (next === null) setListMinHeight(null);
    else if (filter === null) setListMinHeight((gridRef.current?.firstElementChild as HTMLElement | null)?.offsetHeight ?? null);
    setFilter(next);
  }
  const unprocessed = requests.filter((r) => r.status !== "done").length;
  // Открытая карточка остаётся, даже если заявка выпала из фильтра
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const shown = requests.filter((r) => matches(r, filter));

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
          <span className={STEP_NUMBER}>3</span>
          <span className="sr-only">. </span>
          Результат обработки
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {hint && <span className={HINT}>{hint}</span>}
          {/* Обрабатывает все необработанные заявки, а не только те, что видны при фильтре */}
          <button
            type="button"
            className={BUTTON}
            disabled={busy || unprocessed === 0 || !hasDocuments}
            onClick={onProcess}
          >
            {running ? <Spinner /> : <Play {...ICON} />}
            {running
              ? "Обрабатываю…"
              : unprocessed > 0
                ? `Обработать ${unprocessed} ${plural(unprocessed, ["заявку", "заявки", "заявок"])}`
                : "Обработать"}
          </button>
          {requests.length > 0 && (
            <Hint hint={busy ? BUSY_HINT : undefined} align="end">
              <button
                type="button"
                className={DANGER_LINK}
                disabled={busy}
                onClick={() => {
                  setClearError(null);
                  void onClear().then(setClearError);
                }}
              >
                <Trash2 size={14} aria-hidden />
                Очистить список
              </button>
            </Hint>
          )}
        </div>
      </div>

      {clearError && (
        <p className={ERROR} role="alert">
          {clearError}
        </p>
      )}

      {requests.length === 0 && <EmptyResults />}

      {requests.length > 0 && <Counters requests={requests} filter={filter} onFilter={applyFilter} />}

      {requests.length > 0 && (
        <div ref={gridRef} className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          {shown.length === 0 && filter ? (
            <div
              className={`${PANEL} flex flex-col items-start gap-2 p-4`}
              style={listMinHeight ? { minHeight: listMinHeight } : undefined}
            >
              <p className={HINT}>{emptyFilterText(filter)}</p>
              <button type="button" className={LINK_BUTTON} onClick={() => applyFilter(null)}>
                Показать все
              </button>
            </div>
          ) : (
            <ol
              className={`${PANEL} flex flex-col divide-y divide-line overflow-y-auto lg:max-h-[75vh]`}
              style={listMinHeight ? { minHeight: listMinHeight } : undefined}
            >
              {shown.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={r.id === selectedId ? "true" : undefined}
                    className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm motion-safe:transition-colors ${
                      r.id === selectedId ? "bg-selected shadow-[inset_3px_0_0_var(--focus)]" : "hover:bg-subtle"
                    }`}
                    onClick={() => select(r.id)}
                  >
                    <span className="w-6 shrink-0 text-right text-muted">{r.number}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-2 whitespace-pre-line break-words">{r.text}</span>
                      {/* Ошибка — понятным текстом прямо в строке; «Повторить» — в карточке */}
                      {r.status === "error" && r.error && !runStates[r.id] && (
                        <span className="line-clamp-2 break-words text-xs text-danger">{r.error}</span>
                      )}
                    </span>
                    <span className="shrink-0">
                      <Status request={r} runState={runStates[r.id]} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div ref={cardRef} className={`${PANEL} scroll-mt-4 overflow-y-auto p-4 lg:max-h-[75vh]`}>
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
