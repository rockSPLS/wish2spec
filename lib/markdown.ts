import { PATH_SEPARATOR } from "./chunking";
import type { RequestResult, Spec } from "./types";

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
