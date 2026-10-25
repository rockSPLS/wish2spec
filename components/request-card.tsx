"use client";

import { Fragment } from "react";
import { PATH_SEPARATOR } from "@/lib/chunking";
import { CLARIFY_QUESTIONS_TITLE, questionsMarkdown, SPEC_QUESTIONS_TITLE, specMarkdown } from "@/lib/markdown";
import type { IncomingRequest, RequestResult } from "@/lib/types";
import { nextStep, verdictLabel, VERDICT_STYLE } from "@/lib/verdicts";
import { CopyButton } from "./copy-button";
import { ERROR, HINT } from "./ui";

// Карточка выбранной заявки. Весь текст из документов, заявок и ответов модели выводится
// только как текст (React экранирует его), без вставки HTML.

const SOURCE_PREVIEW_CHARS = 200;

export type RunState = "queued" | "processing";

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function VerdictLabel({ result }: { result: RequestResult }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[result.verdict]}`}>
      {verdictLabel(result.verdict, result.taskNumber)}
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

export function RequestCard({ request, runState }: { request: IncomingRequest | null; runState?: RunState }) {
  if (!request) {
    return <p className={HINT}>Выберите заявку в списке, чтобы увидеть разбор.</p>;
  }

  const original = (
    <Block title="Исходная заявка">
      <p className="whitespace-pre-wrap break-words">{request.text}</p>
    </Block>
  );

  const result = request.result;
  if (!result) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm font-medium">Заявка №{request.number}</p>
        {original}
        {runState === "processing" ? (
          <p className={HINT} role="status">
            Обрабатывается…
          </p>
        ) : runState === "queued" ? (
          <p className={HINT}>В очереди на обработку.</p>
        ) : request.status === "error" ? (
          <Block title="Ошибка">
            <p className={ERROR}>{request.error}</p>
            <p className={HINT}>Нажмите «Обработать», чтобы попробовать ещё раз.</p>
          </Block>
        ) : (
          <p className={HINT}>Заявка ещё не обработана. Нажмите «Обработать».</p>
        )}
      </div>
    );
  }

  const known = new Set(result.sources.map((s) => s.n));
  const spec = result.spec ? specMarkdown(request.text, result.spec, result) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <VerdictLabel result={result} />
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Заявка №{request.number}</span>
      </div>

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
          <p className={HINT}>Модель не сослалась ни на один фрагмент.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {result.sources.map((s) => (
              <li key={s.n} id={`source-${request.id}-${s.n}`} className="scroll-mt-4 text-sm">
                <p className="break-words font-medium">
                  [{s.n}] {s.path.join(PATH_SEPARATOR)}
                </p>
                <p className="whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
                  {s.text.length > SOURCE_PREVIEW_CHARS ? `${s.text.slice(0, SOURCE_PREVIEW_CHARS).trimEnd()}…` : s.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Block>

      {spec && result.spec && (
        <Block
          title="Основа ТЗ"
          action={
            <span className="flex flex-wrap justify-end gap-2">
              {/* Открытые вопросы отдельно — чтобы разобрать их с автором или командой, не вырезая из основы ТЗ */}
              {result.spec.questions.length > 0 && (
                <CopyButton
                  text={questionsMarkdown(SPEC_QUESTIONS_TITLE, request.text, result.spec.questions)}
                  label="Копировать вопросы"
                />
              )}
              <CopyButton text={spec} />
            </span>
          }
        >
          <pre className="whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-900">
            {spec}
          </pre>
        </Block>
      )}

      {result.verdict === "clarify" && result.questions.length > 0 && (
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

      <Block title="Что дальше">
        <p>{nextStep(result.verdict, result.taskNumber)}</p>
      </Block>
    </div>
  );
}
