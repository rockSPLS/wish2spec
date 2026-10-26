import { PATH_SEPARATOR } from "./chunking";
import type { IncomingRequest, RequestResult, Source, Spec } from "./types";
import { mentionsTask } from "./verdicts";

// Тексты для кнопок «Копировать» — в Markdown, чтобы вставлять в трекер или письмо.
// Основа ТЗ показывается в карточке этим же текстом, так что скопировано ровно то, что видно.

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function refs(ids: number[]): string {
  return ids.map((n) => `[${n}]`).join(", ");
}

export function specMarkdown(requestText: string, spec: Spec, result: RequestResult): string {
  const modules =
    spec.modules.length === 0
      ? "Связей не найдено."
      : [
          spec.modules.map((m) => `- ${m.name} ${refs(m.sourceIds)}`).join("\n"),
          // Номера источников вне карточки ничего не скажут — расшифровываем их
          "Источники:\n" +
            [...new Set(spec.modules.flatMap((m) => m.sourceIds))]
              .sort((a, b) => a - b)
              .map((n) => {
                const source = result.sources.find((s) => s.n === n);
                return `[${n}] ${source ? source.path.join(PATH_SEPARATOR) : "—"}`;
              })
              .join("\n"),
        ].join("\n\n");

  return [
    `# ${spec.title}`,
    `## Исходная заявка\n\n${quote(requestText)}`,
    `## Проблема и цель\n\n${spec.problem}`,
    `## Сценарий\n\n${spec.scenario.map((step, i) => `${i + 1}. ${step}`).join("\n")}`,
    `## Критерии приёмки\n\n${spec.acceptance.map((item) => `- ${item}`).join("\n")}`,
    `## Затронутые модули\n\n${modules}`,
    `## ${SPEC_QUESTIONS_TITLE}\n\n${spec.questions.map((q) => `- ${q}`).join("\n")}`,
  ].join("\n\n");
}

// У «новое» вопросы бывают и к автору, и к команде — кому какой, решает аналитик, поэтому «Открытые».
// У «требуется уточнение» вопросы — к автору заявки
export const SPEC_QUESTIONS_TITLE = "Открытые вопросы";
export const CLARIFY_QUESTIONS_TITLE = "Уточнить у пользователя";

export function questionsMarkdown(title: string, requestText: string, questions: string[]): string {
  return [
    `## ${title}`,
    `Заявка:\n\n${quote(requestText)}`,
    questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
  ].join("\n\n");
}

// Основа ТЗ, которую видит аналитик: исправленная вручную, если есть, иначе — собранная из ответа модели
export function currentSpec(request: IncomingRequest): { text: string; manual: boolean } | null {
  const edited = request.edits?.spec;
  if (edited) return { text: edited.text, manual: true };
  const result = request.result;
  return result?.spec ? { text: specMarkdown(request.text, result.spec, result), manual: false } : null;
}

// Пункты раздела «Открытые вопросы» из текста основы ТЗ — для «Копировать вопросы»: после правки
// аналитиком вопросы берутся из исправленного текста. Раздела нет или он пуст — пустой список
export function specQuestions(specText: string): string[] {
  const lines = specText.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${SPEC_QUESTIONS_TITLE}`);
  if (start === -1) return [];
  const questions: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)/.exec(line);
    if (item) questions.push(item[1]);
  }
  return questions;
}

// Шаблоны копирования для «похоже на задачу» и «уже есть» — без вызова модели, как строки «Что дальше»

// Номер источника [N] вне карточки ничего не скажет — только путь
const sourceLine = (s: Source) => `- ${s.path.join(PATH_SEPARATOR)}`;

// «Копировать для трекера»: комментарий к похожей задаче — исходная заявка и задача с источником
export function trackerMarkdown(requestText: string, taskNumber: number, sources: Source[]): string {
  const taskSources = sources.filter((s) => mentionsTask(s, taskNumber));
  return [
    `Ещё одна заявка к задаче №${taskNumber}:`,
    quote(requestText),
    taskSources.length > 0
      ? `Где о задаче написано:\n${taskSources.map(sourceLine).join("\n")}`
      : `Похожая задача: №${taskNumber}.`,
  ].join("\n\n");
}

// «Копировать ответ»: короткий ответ автору — где найти функцию: разделы документов, где она описана.
// Источники, где упомянута задача («Задача №N»), сюда не попадают: список задач — внутренний
// документ команды, а не место, где автор найдёт функцию
export function replyMarkdown(requestText: string, sources: Source[]): string {
  const forAuthor = sources.filter((s) => !mentionsTask(s));
  const where =
    forAuthor.length > 0
      ? forAuthor.map(sourceLine).join("\n")
      : "- [укажите, где найти эту функцию]";
  return [
    "Здравствуйте! Спасибо за заявку.",
    `То, о чём вы пишете, в системе уже есть. Где это найти:\n${where}`,
    "Если мы поняли вас неверно, напишите — разберёмся.",
    `Ваша заявка:\n${quote(requestText)}`,
  ].join("\n\n");
}
