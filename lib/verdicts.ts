import { VERDICTS, type IncomingRequest, type ReviewReason, type Verdict } from "./types";

// Тексты ярлыков и блока «Что дальше» — постоянные, без модели:
// подсказка аналитику не должна зависеть от ответа модели

export function verdictLabel(verdict: Verdict, taskNumber: number | null): string {
  switch (verdict) {
    case "exists":
      return "Уже есть";
    case "similar":
      return taskNumber === null ? "Похоже на задачу" : `Похоже на задачу №${taskNumber}`;
    case "new":
      return "Новое";
    case "clarify":
      return "Требуется уточнение";
    case "out_of_scope":
      return "Вне разработки";
  }
}

export function nextStep(verdict: Verdict, taskNumber: number | null): string {
  switch (verdict) {
    case "exists":
      return "Ответьте автору, где найти эту функцию. Ссылка — в источниках.";
    case "similar": {
      const task = taskNumber === null ? "задаче" : `задаче №${taskNumber}`;
      return `Добавьте заявку к ${task} в трекере — это ещё один голос за неё.`;
    }
    case "new":
      return "Проверьте основу ТЗ, решите открытые вопросы с автором или командой и заведите задачу в трекере.";
    case "clarify":
      return "Отправьте автору вопросы. После ответа допишите его в заявку и нажмите «Обработать заново».";
    case "out_of_scope":
      return "Передайте заявку тем, кто за это отвечает, или ответьте автору сами.";
  }
}

// «Задача №12» («задачи №12»…) в пути или тексте фрагмента; «№120» и «№1» друг друга не находят.
// Без номера — любая задача
export function mentionsTask(source: { path: string[]; text: string }, taskNumber?: number): boolean {
  const pattern = new RegExp(`задач\\p{L}*\\s*№\\s*${taskNumber ?? "\\d+"}(?!\\d)`, "iu");
  return pattern.test(source.path.join(" ")) || pattern.test(source.text);
}

// Вердикт, который видит аналитик: исправленный вручную, если он есть, иначе — вердикт AI
export function currentVerdict(request: IncomingRequest): {
  verdict: Verdict;
  taskNumber: number | null;
  manual: boolean;
} | null {
  if (!request.result) return null;
  const edited = request.edits?.verdict;
  if (edited) return { verdict: edited.verdict, taskNumber: edited.taskNumber, manual: true };
  return { verdict: request.result.verdict, taskNumber: request.result.taskNumber, manual: false };
}

// Отметка «Проверьте» и строки с причинами. Отметку ставит код (lib/process.ts), не модель
export const REVIEW_MARK = "Проверьте";

export const MANUAL_MARK = "изменено вручную";

// Причины отметки «Проверьте», которые видит аналитик. Они относятся к ответу модели: если аналитик
// сменил вердикт вручную, он заявку уже проверил, и отметка снимается. У результатов v0.1 причин нет
export function currentReview(request: IncomingRequest): ReviewReason[] {
  if (!request.result || request.edits?.verdict) return [];
  return request.result.review ?? [];
}

export function reviewReasonText(reason: ReviewReason): string {
  switch (reason.kind) {
    case "task-not-found":
      return `Задачи №${reason.taskNumber} нет в найденных фрагментах — номер мог быть указан ошибочно.`;
    case "task-missing":
      return "Номер задачи не указан — найдите её в источниках.";
    case "no-links":
      return "Связей в документах не найдено: вердикт — только по тексту заявки.";
  }
}

// Служебные имена вердиктов (exists, new…) модель видит в схеме ответа и иногда пишет их
// в текст обоснования. В тексте для аналитика они заменяются русскими ярлыками:
// «Это не out_of_scope» → «Это не «Вне разработки»». Кавычки и обратные апострофы вокруг имени убираются.
// Не заменяется внутри слов, ссылок и путей («new2», «/new/», «new.html») и рядом с латинским словом
// («What's new»): там это обычный английский текст из заявки или документов, а не вердикт.
// Соседнее служебное имя латинским словом не считается: «не new, similar или clarify»
// и «exists/similar» заменяются целиком, в том числе в кавычках: «"new"/"similar"»
const VERDICT_ID_IN_TEXT = /[«"'`]?(?<![\p{L}\p{N}_])(exists|similar|new|clarify|out_of_scope)(?![\p{L}\p{N}_])[»"'`]?/gu;
const isVerdictId = (word: string | undefined) => !!word && (VERDICTS as readonly string[]).includes(word);

export function humanizeVerdictIds(text: string): string {
  return text.replace(VERDICT_ID_IN_TEXT, (match: string, id: Verdict, offset: number) => {
    const before = text.slice(0, offset);
    const after = text.slice(offset + match.length);
    // Вплотную знак ссылки или пути (/ . : @ -) — это не вердикт; через «/» допускается только другое служебное имя
    const glueBefore = /[/.:@-]$/.exec(before)?.[0];
    if (glueBefore && !(glueBefore === "/" && isVerdictId(/([A-Za-z_]+)[»"'`]?\/$/.exec(before)?.[1]))) return match;
    const glueAfter = /^(?:[/@-]|[.:][\p{L}\p{N}])/u.exec(after)?.[0];
    if (glueAfter && !(glueAfter === "/" && isVerdictId(/^\/[«"'`]?([A-Za-z_]+)/.exec(after)?.[1]))) return match;
    // Рядом латинское слово, которое само не служебное имя, — это английский текст.
    // Кроме out_of_scope: с подчёркиванием в обычном английском такого слова нет, и «definitely out_of_scope» —
    // служебное имя в английской вставке модели
    const prevWord = /([A-Za-z][A-Za-z_'’]*)[\s,]*$/.exec(before)?.[1];
    const nextWord = /^[\s,]*([A-Za-z][A-Za-z_'’]*)/.exec(after)?.[1];
    if (id !== "out_of_scope" && ((prevWord && !isVerdictId(prevWord)) || (nextWord && !isVerdictId(nextWord)))) {
      return match;
    }
    return `«${verdictLabel(id, null)}»`;
  });
}

// Цвета ярлыков — свои у каждого вердикта, отдельно от фирменного цвета (app/globals.css):
// ярлык не должен сливаться с кнопками
export const VERDICT_STYLE: Record<Verdict, string> = {
  exists: "bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-100",
  similar: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
  new: "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100",
  clarify: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  out_of_scope: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
};

export const REVIEW_STYLE =
  "border border-orange-400 text-orange-800 dark:border-orange-500 dark:text-orange-200";
