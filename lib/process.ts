import "server-only";
import { generateText, NoObjectGeneratedError, Output, type LanguageModelUsage } from "ai";
import { z } from "zod";
import { PATH_SEPARATOR } from "./chunking";
import { getConfig } from "./config";
import { chatModel, resolveReasoningEffort } from "./llm";
import {
  ANALYSIS_FIELDS,
  ANALYSIS_NO_FRAGMENTS,
  ANALYSIS_SYSTEM,
  analysisPrompt,
  SPEC_FIELDS,
  SPEC_SYSTEM,
  specPrompt,
  type PromptFragment,
} from "./prompts";
import { findClosest } from "./search";
import { UserError } from "./errors";
import { readDocuments } from "./store";
import { VERDICTS, type CallUsage, type RequestResult, type ReviewReason, type Source, type Spec, type Verdict } from "./types";
import { humanizeVerdictIds, mentionsTask } from "./verdicts";

// Обработка одной входящей заявки:
// 1) эмбеддинг заявки (длинной — по частям); 2) до TOP_K ближайших фрагментов не ниже порога;
// 3) модель по строгой схеме — разбор, вердикт, обоснование, источники; 4) для «новое» — второй
// вызов: основа ТЗ; 5) отметка «Проверьте», если вердикт стоит перепроверить.

// Если ни один фрагмент не прошёл порог, вердикты «уже есть» и «похоже на задачу» не на что опереть —
// схема ответа сама не даёт их выбрать
const NO_FRAGMENT_VERDICTS = ["new", "clarify", "out_of_scope"] as const;

const analysisSchema = (noFragments: boolean) =>
  z.object({
    analysis: z.object({
      who: z.string().describe(ANALYSIS_FIELDS.who),
      what: z.string().describe(ANALYSIS_FIELDS.what),
      where: z.string().describe(ANALYSIS_FIELDS.where),
    }),
    // Тип — общий для обоих случаев: дальше код работает с любым вердиктом
    verdict: (noFragments
      ? z.enum(NO_FRAGMENT_VERDICTS).describe(ANALYSIS_FIELDS.verdictNoFragments)
      : z.enum(VERDICTS).describe(ANALYSIS_FIELDS.verdict)) as z.ZodType<Verdict>,
    taskNumber: z.number().int().nullable().describe(ANALYSIS_FIELDS.taskNumber),
    reasoning: z.string().describe(ANALYSIS_FIELDS.reasoning),
    sourceIds: z.array(z.number().int()).describe(ANALYSIS_FIELDS.sourceIds),
    questions: z.array(z.string()).describe(ANALYSIS_FIELDS.questions),
  });

const specSchema = z.object({
  title: z.string().describe(SPEC_FIELDS.title),
  problem: z.string().describe(SPEC_FIELDS.problem),
  scenario: z.array(z.string()).describe(SPEC_FIELDS.scenario),
  acceptance: z.array(z.string()).describe(SPEC_FIELDS.acceptance),
  modules: z
    .array(
      z.object({
        name: z.string().describe(SPEC_FIELDS.moduleName),
        sourceIds: z.array(z.number().int()).describe(SPEC_FIELDS.moduleSourceIds),
      }),
    )
    .describe(SPEC_FIELDS.modules),
  questions: z.array(z.string()).describe(SPEC_FIELDS.questions),
});

function toCallUsage(usage: LanguageModelUsage | undefined): CallUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

// Вызов модели по схеме. Сервис принимает строгую JSON-схему, а ответ ещё раз проверяется zod.
// Если ответ всё же не совпал со схемой — один повтор; токены считаются за обе попытки
async function generateStructured<T>(
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
  reasoningEffort: string | undefined,
): Promise<{ output: T; usage: CallUsage }> {
  let usage = toCallUsage(undefined);
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await generateText({
        model: chatModel({ reasoningEffort }),
        system,
        prompt,
        output: Output.object({ schema }),
      });
      return { output: result.output, usage: addUsage(usage, toCallUsage(result.usage)) };
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error) || attempt >= 2) throw error;
      usage = addUsage(usage, toCallUsage(error.usage));
    }
  }
}

// Номера, которых не было среди переданных фрагментов, отбрасываются
function validIds(ids: number[], known: number[]): number[] {
  return [...new Set(ids)].filter((n) => known.includes(n)).sort((a, b) => a - b);
}

// Основа ТЗ — второй вызов модели. Затронутые модули — только с номерами переданных фрагментов;
// модуль без них отбрасывается
async function generateSpec(
  text: string,
  fragments: PromptFragment[],
  analysis: { what: string; where: string; reasoning: string },
  reasoningEffort: string | undefined,
): Promise<{ spec: Spec; usage: CallUsage }> {
  const generated = await generateStructured(specSchema, SPEC_SYSTEM, specPrompt(text, fragments, analysis), reasoningEffort);
  const known = fragments.map((f) => f.n);
  const g = generated.output;
  return {
    spec: {
      title: humanizeVerdictIds(g.title),
      problem: humanizeVerdictIds(g.problem),
      scenario: g.scenario.map(humanizeVerdictIds),
      acceptance: g.acceptance.map(humanizeVerdictIds),
      modules: g.modules
        .map((m) => ({ name: m.name.trim(), sourceIds: validIds(m.sourceIds, known) }))
        .filter((m) => m.name && m.sourceIds.length > 0),
      questions: g.questions.map(humanizeVerdictIds),
    },
    usage: generated.usage,
  };
}

// Ссылки [N] в тексте обоснования — чтобы каждая из них была в списке источников
function referencedIds(text: string): number[] {
  return [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

const round = (score: number) => Math.round(score * 1000) / 1000;

export type ProcessOptions = {
  // Только для маршрута замера; без него — значение из настроек (см. resolveReasoningEffort)
  reasoningEffort?: string;
};

export const NO_DOCUMENTS = "Документация системы не загружена — сначала добавьте документы в шаге 1.";

export async function processRequestText(text: string, options: ProcessOptions = {}): Promise<RequestResult> {
  const start = performance.now();
  const config = getConfig();
  // Итоговое значение — один раз: им вызывается модель, оно же записывается в результат
  const reasoningEffort = resolveReasoningEffort(options.reasoningEffort);

  const documents = await readDocuments();
  if (documents.length === 0) {
    throw new UserError(NO_DOCUMENTS);
  }

  const search = await findClosest(text, documents);
  const found = search.kept;
  const noFragments = found.length === 0;
  const fragments: PromptFragment[] = found.map((f, i) => ({
    n: i + 1,
    path: f.chunk.path.join(PATH_SEPARATOR),
    text: f.chunk.text,
  }));

  const analysis = await generateStructured(
    analysisSchema(noFragments),
    noFragments ? ANALYSIS_SYSTEM + ANALYSIS_NO_FRAGMENTS : ANALYSIS_SYSTEM,
    analysisPrompt(text, fragments),
    reasoningEffort,
  );
  const answer = analysis.output;
  const verdict = answer.verdict;

  let spec: Spec | null = null;
  let specUsage: CallUsage | null = null;
  if (verdict === "new") {
    const generated = await generateSpec(
      text,
      fragments,
      { what: answer.analysis.what, where: answer.analysis.where, reasoning: answer.reasoning },
      reasoningEffort,
    );
    spec = generated.spec;
    specUsage = generated.usage;
  }

  const cited = validIds(
    [
      ...answer.sourceIds,
      ...referencedIds(answer.reasoning),
      ...(spec?.modules.flatMap((m) => m.sourceIds) ?? []),
    ],
    fragments.map((f) => f.n),
  );
  const sources: Source[] = cited.map((n) => ({
    n,
    documentName: found[n - 1].documentName,
    path: found[n - 1].chunk.path,
    text: found[n - 1].chunk.text,
  }));

  const taskNumber = verdict === "similar" ? answer.taskNumber : null;

  // Отметка «Проверьте» — по фактам, которые проверяет код, а не по оценке модели
  const review: ReviewReason[] = [];
  // Номер ищется во всех найденных фрагментах, переданных модели, а не только в тех, на которые
  // она сослалась: задача могла быть найдена, но не попасть в источники — тогда номер, скорее всего, верный
  if (taskNumber !== null && !found.some((f) => mentionsTask(f.chunk, taskNumber))) {
    review.push({ kind: "task-not-found", taskNumber });
  }
  if (verdict === "similar" && taskNumber === null) review.push({ kind: "task-missing" });
  if (noFragments) review.push({ kind: "no-links" });

  return {
    verdict,
    taskNumber,
    analysis: {
      who: humanizeVerdictIds(answer.analysis.who),
      what: humanizeVerdictIds(answer.analysis.what),
      where: humanizeVerdictIds(answer.analysis.where),
    },
    reasoning: humanizeVerdictIds(answer.reasoning),
    questions: verdict === "clarify" ? answer.questions.map(humanizeVerdictIds) : [],
    sources,
    retrieved: found.map((f, i) => ({ n: i + 1, path: f.chunk.path, score: round(f.score) })),
    discarded: search.discarded.map((f) => ({ path: f.chunk.path, score: round(f.score) })),
    searchParts: search.parts,
    review,
    spec,
    processedAt: new Date().toISOString(),
    model: config.llm.model,
    reasoningEffort: reasoningEffort ?? null,
    ms: Math.round(performance.now() - start),
    usage: { analysis: analysis.usage, spec: specUsage },
  };
}

// «Подготовить основу ТЗ» для заявки с любым вердиктом — тот же вызов модели, что для «новое».
// Фрагменты — источники из сохранённого результата, с теми же номерами: так ссылки основы ТЗ
// совпадают с источниками карточки, и основа готовится, даже если документы уже удалены или заменены
export async function prepareSpec(text: string, result: RequestResult): Promise<{ spec: Spec; usage: CallUsage }> {
  const fragments: PromptFragment[] = result.sources.map((s) => ({
    n: s.n,
    path: s.path.join(PATH_SEPARATOR),
    text: s.text,
  }));
  return generateSpec(
    text,
    fragments,
    { what: result.analysis.what, where: result.analysis.where, reasoning: result.reasoning },
    resolveReasoningEffort(),
  );
}
