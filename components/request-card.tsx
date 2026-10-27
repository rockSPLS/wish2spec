"use client";

import { FileText, Pencil, Play, RefreshCw, RotateCw, Tag, Trash2, Undo2 } from "lucide-react";
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
import { Hint } from "./hint";
import { Progress } from "./progress";
import { BUSY_HINT, BUTTON, BUTTON_SECONDARY, DANGER_LINK, ERROR, HINT, ICON, LINK_BUTTON, NO_DOCUMENTS_HINT } from "./ui";

// Карточка выбранной заявки. Весь текст из документов, заявок и ответов модели выводится
// только как текст (React экранирует его), без вставки HTML.

const SOURCE_PREVIEW_CHARS = 200;

// Карточка появляется коротко и спокойно; при «уменьшить движение» — без анимации
const CARD = "flex flex-col gap-5 motion-safe:animate-appear";

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

// main — заголовок главного результата карточки (основа ТЗ): цвет основного текста и крупнее,
// остальные заголовки серые. Блоки разделены тонкой линией сверху: в длинной карточке иначе сливаются
function Block({ title, main, mark, action, children }: {
  title: string;
  main?: boolean;
  mark?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3
          className={`flex flex-wrap items-center gap-2 font-semibold uppercase tracking-wide ${
            main ? "text-[17px] text-foreground" : "text-sm text-muted"
          }`}
        >
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
    <span className="inline-block rounded border border-line-strong px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-muted">
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
            <a key={i} href={`#source-${requestId}-${n[1]}`} className="text-link hover:underline">
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
    <li id={`source-${requestId}-${source.n}`} className="scroll-mt-4 py-3 text-sm first:pt-0 last:pb-0">
      <p className="break-words font-medium">
        [{source.n}] {source.path.join(PATH_SEPARATOR)}
      </p>
      <p className="whitespace-pre-wrap break-words text-muted">
        {long && !full ? `${source.text.slice(0, SOURCE_PREVIEW_CHARS).trimEnd()}…` : source.text}
      </p>
      {long && (
        <button
          type="button"
          className="text-link hover:underline"
          aria-expanded={full}
          onClick={() => setFull((f) => !f)}
        >
          {full ? "Свернуть" : "Показать целиком"}
        </button>
      )}
    </li>
  );
}

export function RequestCard({
  request,
  runState,
  busy,
  hasDocuments,
  actions,
}: {
  request: IncomingRequest | null;
  runState?: RunState;
  busy: boolean;
  hasDocuments: boolean;
  actions: CardActions;
}) {
  if (!request) {
    return <p className={HINT}>Выберите заявку в списке, чтобы увидеть разбор.</p>;
  }
  // key: при выборе другой заявки открытые формы и раскрытые источники сбрасываются
  return (
    <Card
      key={request.id}
      request={request}
      runState={runState}
      busy={busy}
      hasDocuments={hasDocuments}
      actions={actions}
    />
  );
}

function Card({
  request,
  runState,
  busy,
  hasDocuments,
  actions,
}: {
  request: IncomingRequest;
  runState?: RunState;
  busy: boolean;
  hasDocuments: boolean;
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
  // Почему кнопки неактивны — при наведении
  const busyHint = busy ? BUSY_HINT : undefined;

  async function run(action: () => Promise<string | null>) {
    setError(null);
    setError(await action());
  }

  const canProcessAgain = !!result && request.status === "done";

  const toolbar = (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {canProcessAgain && (
          <Hint hint={busyHint}>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={busy}
              onClick={() => void run(() => actions.process(request.id, { again: true }))}
            >
              <RefreshCw {...ICON} />
              Обработать заново
            </button>
          </Hint>
        )}
        {request.previous && (
          <Hint hint={busyHint}>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={busy}
              onClick={() => void run(() => actions.edit({ action: "restore", id: request.id }))}
            >
              <Undo2 {...ICON} />
              Вернуть прежний вариант
            </button>
          </Hint>
        )}
        <Hint hint={busyHint} align="end" className="ml-auto">
          <button
            type="button"
            className={DANGER_LINK}
            disabled={busy}
            onClick={() => void run(() => actions.remove(request))}
          >
            <Trash2 size={14} aria-hidden />
            Удалить
          </button>
        </Hint>
      </div>
      {/* Аналитику в этот момент важно, не потеряется ли результат */}
      {canProcessAgain && <p className={HINT}>Текущий результат сохранится — его можно будет вернуть.</p>}
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
          <Hint hint={busyHint}>
            <button type="button" className={LINK_BUTTON} disabled={busy} onClick={editText}>
              <Pencil size={14} aria-hidden />
              Править
            </button>
          </Hint>
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
          processing={runState === "processing"}
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
      // Исправленный текст обрабатывается — строка о процессе в самой форме, у её кнопки
      editing === "text" ? (
        <></>
      ) : (
        <Progress>Обрабатывается…</Progress>
      )
    ) : runState === "queued" ? (
      <p className={HINT}>В очереди на обработку.</p>
    ) : request.status === "error" ? (
      <Block title="Ошибка">
        <p className={ERROR}>{request.error}</p>
        <Hint hint={busyHint}>
          <button
            type="button"
            className={`${BUTTON} w-fit`}
            disabled={busy}
            onClick={() => void actions.process(request.id)}
          >
            <RotateCw {...ICON} />
            Повторить
          </button>
        </Hint>
      </Block>
    ) : null;

  if (!result || !verdict) {
    return (
      <div className={CARD}>
        <p className="text-sm font-medium">Заявка №{request.number}</p>
        {toolbar}
        {previousHint}
        {error && (
          <p className={ERROR} role="alert">
            {error}
          </p>
        )}
        {original}
        {status ?? (
          // Одну заявку можно обработать раньше остальных — тем же путём, что и при обработке списка
          <div className="flex flex-wrap items-center gap-3">
            <p className={HINT}>Заявка ещё не обработана.</p>
            <Hint hint={busy ? BUSY_HINT : !hasDocuments ? NO_DOCUMENTS_HINT : undefined}>
              <button
                type="button"
                className={BUTTON}
                disabled={busy || !hasDocuments}
                onClick={() => void run(() => actions.process(request.id))}
              >
                <Play {...ICON} />
                Обработать
              </button>
            </Hint>
          </div>
        )}
      </div>
    );
  }

  const known = new Set(result.sources.map((s) => s.n));
  // Без правок — вопросы из ответа модели, после правки — из исправленного текста
  const questions = spec?.manual ? specQuestions(spec.text) : (result.spec?.questions ?? []);

  return (
    <div className={CARD}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictLabel verdict={verdict.verdict} taskNumber={verdict.taskNumber} />
          {review.length > 0 && <ReviewMark />}
          {verdict.manual && <ManualMark />}
          <span className="ml-1 text-sm text-muted">Заявка №{request.number}</span>
          {editing !== "verdict" && (
            <Hint hint={busyHint}>
              <button type="button" className={LINK_BUTTON} disabled={busy} onClick={() => setEditing("verdict")}>
                <Tag size={14} aria-hidden />
                Изменить вердикт
              </button>
            </Hint>
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
          <dt className="text-muted">Кто</dt>
          <dd className="break-words">{result.analysis.who}</dd>
          <dt className="text-muted">Что</dt>
          <dd className="break-words">{result.analysis.what}</dd>
          <dt className="text-muted">Где в системе</dt>
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
          <ol className="flex flex-col divide-y divide-line">
            {result.sources.map((s) => (
              <SourceItem key={s.n} source={s} requestId={request.id} />
            ))}
          </ol>
        )}
      </Block>

      {spec ? (
        <Block
          title="Основа ТЗ"
          main
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
                <Hint hint={busyHint}>
                  <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => setEditing("spec")}>
                    <Pencil {...ICON} />
                    Править
                  </button>
                </Hint>
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
            <pre className="whitespace-pre-wrap break-words rounded-md bg-subtle p-3 font-sans text-sm">
              {spec.text}
            </pre>
          )}
        </Block>
      ) : (
        <Block
          title="Основа ТЗ"
          main
          action={
            <Hint hint={busyHint}>
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
                {specError ? <RotateCw {...ICON} /> : <FileText {...ICON} />}
                {specError ? "Повторить" : "Подготовить основу ТЗ"}
              </button>
            </Hint>
          }
        >
          {runState === "spec" ? (
            <Progress>Готовлю основу ТЗ…</Progress>
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
