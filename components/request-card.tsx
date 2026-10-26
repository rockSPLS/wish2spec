"use client";

import { Fragment, useState } from "react";
import { PATH_SEPARATOR } from "@/lib/chunking";
import {
  CLARIFY_QUESTIONS_TITLE,
  currentSpec,
  questionsMarkdown,
  replyMarkdown,
  SPEC_QUESTIONS_TITLE,
  specQuestions,
  trackerMarkdown,
} from "@/lib/markdown";
import type { IncomingRequest, Source, Verdict } from "@/lib/types";
import {
  currentReview,
  currentVerdict,
  MANUAL_MARK,
  nextStep,
  REVIEW_MARK,
  REVIEW_STYLE,
  reviewReasonText,
  verdictLabel,
  VERDICT_STYLE,
} from "@/lib/verdicts";
import { RequestTextEditor, SpecEditor, VerdictEditor } from "./card-editors";
import { CopyButton } from "./copy-button";
import { BUTTON, BUTTON_SECONDARY, ERROR, HINT } from "./ui";

// Карточка выбранной заявки. Весь текст из документов, заявок и ответов модели выводится
// только как текст (React экранирует его), без вставки HTML.

const SOURCE_PREVIEW_CHARS = 200;

// queued и processing — обработка заявки, spec — «Подготовить основу ТЗ»
export type RunState = "queued" | "processing" | "spec";

// Правки, которые карточка отправляет на сервер (маршрут /api/requests, PATCH)
export type EditBody =
  | { action: "verdict"; id: string; verdict: Verdict; taskNumber: number | null }
  | { action: "spec"; id: string; text: string }
  | { action: "restore"; id: string };

// Действия карточки; ошибка возвращается текстом, null — всё прошло
export type CardActions = {
  process: (id: string, options?: { again?: boolean; text?: string }) => Promise<string | null>;
  edit: (body: EditBody) => Promise<string | null>;
  prepareSpec: (id: string) => Promise<string | null>;
  remove: (request: IncomingRequest) => Promise<string | null>;
};

function Block({ title, mark, action, children }: {
  title: string;
  mark?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          {title}
          {mark}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function VerdictLabel({ verdict, taskNumber }: { verdict: Verdict; taskNumber: number | null }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[verdict]}`}>
      {verdictLabel(verdict, taskNumber)}
    </span>
  );
}

// Отметка «Проверьте» рядом с ярлыком вердикта — её ставит код, когда вердикт стоит перепроверить
export function ReviewMark() {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${REVIEW_STYLE}`}>{REVIEW_MARK}</span>
  );
}

// Пометка «изменено вручную» — у вердикта и основы ТЗ, которые исправил аналитик
function ManualMark() {
  return (
    <span className="inline-block rounded border border-zinc-400 px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
      {MANUAL_MARK}
    </span>
  );
}

// Ссылки [1], [2] в обосновании ведут к источнику с тем же номером в карточке
function WithRefs({ text, requestId, known }: { text: string; requestId: string; known: Set<number> }) {
  const parts = text.split(/(\[\d+\])/);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part);
        if (n && known.has(Number(n[1]))) {
          return (
            <a key={i} href={`#source-${requestId}-${n[1]}`} className="text-sky-700 hover:underline dark:text-sky-400">
              {part}
            </a>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

// Источник: по умолчанию — начало фрагмента, «Показать целиком» раскрывает его
function SourceItem({ source, requestId }: { source: Source; requestId: string }) {
  const [full, setFull] = useState(false);
  const long = source.text.length > SOURCE_PREVIEW_CHARS;
  return (
    <li id={`source-${requestId}-${source.n}`} className="scroll-mt-4 text-sm">
      <p className="break-words font-medium">
        [{source.n}] {source.path.join(PATH_SEPARATOR)}
      </p>
      <p className="whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
        {long && !full ? `${source.text.slice(0, SOURCE_PREVIEW_CHARS).trimEnd()}…` : source.text}
      </p>
      {long && (
        <button
          type="button"
          className="text-sky-700 hover:underline dark:text-sky-400"
          aria-expanded={full}
          onClick={() => setFull((f) => !f)}
        >
          {full ? "Свернуть" : "Показать целиком"}
        </button>
      )}
    </li>
  );
}

const LINK_BUTTON = "text-sm text-sky-700 hover:underline disabled:opacity-40 disabled:no-underline dark:text-sky-400";

export function RequestCard({
  request,
  runState,
  busy,
  actions,
}: {
  request: IncomingRequest | null;
  runState?: RunState;
  busy: boolean;
  actions: CardActions;
}) {
  if (!request) {
    return <p className={HINT}>Выберите заявку в списке, чтобы увидеть разбор.</p>;
  }
  // key: при выборе другой заявки открытые формы и раскрытые источники сбрасываются
  return <Card key={request.id} request={request} runState={runState} busy={busy} actions={actions} />;
}

function Card({
  request,
  runState,
  busy,
  actions,
}: {
  request: IncomingRequest;
  runState?: RunState;
  busy: boolean;
  actions: CardActions;
}) {
  const [editing, setEditing] = useState<"verdict" | "spec" | "text" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  // Форма «Править» у текста заявки — здесь, а не в самой форме: см. RequestTextEditor
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  function editText() {
    setDraft(request.text);
    setDraftError(null);
    setEditing("text");
  }

  async function processDraft() {
    setDraftError(null);
    const problem = await actions.process(request.id, { again: true, text: draft });
    if (problem) setDraftError(problem);
    else setEditing(null);
  }

  const result = request.result;
  const verdict = currentVerdict(request);
  const review = currentReview(request);
  const spec = currentSpec(request);

  async function run(action: () => Promise<string | null>) {
    setError(null);
    setError(await action());
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {result && request.status === "done" && (
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={busy}
          onClick={() => void run(() => actions.process(request.id, { again: true }))}
        >
          Обработать заново
        </button>
      )}
      {request.previous && (
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={busy}
          onClick={() => void run(() => actions.edit({ action: "restore", id: request.id }))}
        >
          Вернуть прежний вариант
        </button>
      )}
      <button
        type="button"
        className="ml-auto text-sm text-red-700 hover:underline disabled:opacity-40 dark:text-red-400"
        disabled={busy}
        onClick={() => void run(() => actions.remove(request))}
      >
        Удалить
      </button>
    </div>
  );

  // Каким был прежний вариант — чтобы было понятно, что вернёт кнопка
  // edits — явно: у прежней версии без правок этого поля нет, и иначе взялись бы правки текущей
  const previousVerdict =
    request.previous && currentVerdict({ ...request, ...request.previous, edits: request.previous.edits });
  const previousHint = request.previous && (
    <p className={HINT}>
      Прежний вариант:{" "}
      {previousVerdict
        ? `«${verdictLabel(previousVerdict.verdict, previousVerdict.taskNumber)}»`
        : "без результата"}
      .
    </p>
  );

  const original = (
    <Block
      title="Исходная заявка"
      action={
        editing !== "text" && (
          <button type="button" className={LINK_BUTTON} disabled={busy} onClick={editText}>
            Править
          </button>
        )
      }
    >
      {editing === "text" ? (
        <RequestTextEditor
          value={draft}
          onChange={setDraft}
          error={draftError}
          hasResult={request.status === "done"}
          disabled={busy}
          onProcess={() => void processDraft()}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words">{request.text}</p>
      )}
    </Block>
  );

  const status =
    runState === "processing" ? (
      <p className={HINT} role="status">
        Обрабатывается…
      </p>
    ) : runState === "queued" ? (
      <p className={HINT}>В очереди на обработку.</p>
    ) : request.status === "error" ? (
      <Block title="Ошибка">
        <p className={ERROR}>{request.error}</p>
        <button
          type="button"
          className={`${BUTTON} w-fit`}
          disabled={busy}
          onClick={() => void actions.process(request.id)}
        >
          Повторить
        </button>
      </Block>
    ) : null;

  if (!result || !verdict) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm font-medium">Заявка №{request.number}</p>
        {toolbar}
        {previousHint}
        {error && (
          <p className={ERROR} role="alert">
            {error}
          </p>
        )}
        {original}
        {status ?? <p className={HINT}>Заявка ещё не обработана. Нажмите «Обработать».</p>}
      </div>
    );
  }

  const known = new Set(result.sources.map((s) => s.n));
  // Без правок — вопросы из ответа модели, после правки — из исправленного текста
  const questions = spec?.manual ? specQuestions(spec.text) : (result.spec?.questions ?? []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictLabel verdict={verdict.verdict} taskNumber={verdict.taskNumber} />
          {review.length > 0 && <ReviewMark />}
          {verdict.manual && <ManualMark />}
          <span className="ml-1 text-sm text-zinc-600 dark:text-zinc-400">Заявка №{request.number}</span>
          {editing !== "verdict" && (
            <button type="button" className={LINK_BUTTON} disabled={busy} onClick={() => setEditing("verdict")}>
              Изменить вердикт
            </button>
          )}
        </div>
        {/* Каждая причина — отдельной строкой */}
        {review.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-orange-800 dark:text-orange-200">
            {review.map((reason) => (
              <li key={reason.kind} className="break-words">
                {reviewReasonText(reason)}
              </li>
            ))}
          </ul>
        )}
        {verdict.manual && (
          <p className={HINT}>Вердикт AI: «{verdictLabel(result.verdict, result.taskNumber)}».</p>
        )}
        {editing === "verdict" && (
          <VerdictEditor
            verdict={verdict.verdict}
            taskNumber={verdict.taskNumber}
            disabled={busy}
            onSave={(v) => actions.edit({ action: "verdict", id: request.id, ...v })}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>

      {toolbar}
      {previousHint}
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
      {status}

      {original}

      <Block title="Разбор">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-zinc-600 dark:text-zinc-400">Кто</dt>
          <dd className="break-words">{result.analysis.who}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">Что</dt>
          <dd className="break-words">{result.analysis.what}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">Где в системе</dt>
          <dd className="break-words">{result.analysis.where}</dd>
        </dl>
      </Block>

      <Block title="Обоснование">
        <WithRefs text={result.reasoning} requestId={request.id} known={known} />
      </Block>

      <Block title="Источники">
        {result.sources.length === 0 ? (
          <p className={HINT}>
            {result.retrieved.length === 0
              ? "В документах не нашлось фрагментов, связанных с заявкой."
              : "Модель не сослалась ни на один фрагмент."}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {result.sources.map((s) => (
              <SourceItem key={s.n} source={s} requestId={request.id} />
            ))}
          </ol>
        )}
      </Block>

      {spec ? (
        <Block
          title="Основа ТЗ"
          mark={spec.manual && <ManualMark />}
          action={
            editing !== "spec" && (
              <span className="flex flex-wrap justify-end gap-2">
                {/* Открытые вопросы отдельно — чтобы разобрать их с автором или командой, не вырезая из основы ТЗ */}
                {questions.length > 0 && (
                  <CopyButton
                    text={questionsMarkdown(SPEC_QUESTIONS_TITLE, request.text, questions)}
                    label="Копировать вопросы"
                  />
                )}
                <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => setEditing("spec")}>
                  Править
                </button>
                <CopyButton text={spec.text} />
              </span>
            )
          }
        >
          {editing === "spec" ? (
            <SpecEditor
              text={spec.text}
              disabled={busy}
              onSave={(text) => actions.edit({ action: "spec", id: request.id, text })}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-900">
              {spec.text}
            </pre>
          )}
        </Block>
      ) : (
        <Block
          title="Основа ТЗ"
          action={
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={busy}
              onClick={() => {
                setSpecError(null);
                void actions.prepareSpec(request.id).then(setSpecError);
              }}
            >
              {/* После ошибки — «Повторить», как в её тексте */}
              {specError ? "Повторить" : "Подготовить основу ТЗ"}
            </button>
          }
        >
          {runState === "spec" ? (
            <p className={HINT} role="status">
              Готовлю основу ТЗ…
            </p>
          ) : (
            <p className={HINT}>Модель подготовит основу ТЗ по источникам этой заявки.</p>
          )}
          {specError && (
            <p className={ERROR} role="alert">
              {specError}
            </p>
          )}
        </Block>
      )}

      {verdict.verdict === "clarify" && result.questions.length > 0 && (
        <Block
          title={CLARIFY_QUESTIONS_TITLE}
          action={<CopyButton text={questionsMarkdown(CLARIFY_QUESTIONS_TITLE, request.text, result.questions)} />}
        >
          <ol className="list-decimal pl-6">
            {result.questions.map((q, i) => (
              <li key={i} className="break-words">
                {q}
              </li>
            ))}
          </ol>
        </Block>
      )}

      <Block
        title="Что дальше"
        action={
          verdict.verdict === "similar" && verdict.taskNumber !== null ? (
            <CopyButton
              text={trackerMarkdown(request.text, verdict.taskNumber, result.sources)}
              label="Копировать для трекера"
            />
          ) : verdict.verdict === "exists" ? (
            <CopyButton text={replyMarkdown(request.text, result.sources)} label="Копировать ответ" />
          ) : undefined
        }
      >
        <p>{nextStep(verdict.verdict, verdict.taskNumber)}</p>
      </Block>
    </div>
  );
}
