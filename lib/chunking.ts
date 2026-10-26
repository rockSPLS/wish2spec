// Нарезка документа на фрагменты для поиска.
// Markdown режется по заголовкам: каждый раздел — отдельный фрагмент, чтобы, например,
// задача №13 и задача №14 не попали в один кусок. Длинный раздел и текст без заголовков (.txt)
// делятся по абзацам примерно до CHUNK_MAX_CHARS с перекрытием около CHUNK_OVERLAP_CHARS.
// Предел модели эмбеддингов — 512 токенов; сколько это символов русского текста — замер в DEV_NOTES (v0.1).

export const CHUNK_MAX_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 150;

export type DocumentFormat = "md" | "txt";

export type Chunk = {
  path: string[]; // «Документ › Раздел › Подраздел»
  text: string;
};

export const PATH_SEPARATOR = " › ";

// Текст, который превращается в эмбеддинг и передаётся модели: путь заголовков + текст раздела.
// Путь нужен, чтобы фрагмент «включено по умолчанию» не терял, к чему относится
export function chunkContent(chunk: Chunk): string {
  return `${chunk.path.join(PATH_SEPARATOR)}\n${chunk.text}`;
}

// Раздел короче этого склеивается с соседним: фрагмент из одной строки («Расписание, Запись
// на занятия») поиск считает близким почти к любой заявке, и он вытесняет полезные фрагменты.
// Замер — в DEV_NOTES (v0.1)
export const SHORT_SECTION_CHARS = 100;

export function chunkDocument(name: string, text: string, format: DocumentFormat): Chunk[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const sections =
    format === "md"
      ? mergeShortSections(splitMarkdownSections(name, normalized))
      : [{ headings: [], body: normalized }];
  return sections.flatMap(({ headings, body }) =>
    packParagraphs(paragraphs(body)).map((part) => ({ path: [name, ...headings], text: part })),
  );
}

// Длинная входящая заявка для поиска делится на части так же, как длинный раздел документа:
// модель эмбеддингов читает только первые 512 токенов, и без частей конец письма в поиске
// не участвовал бы. Абзацы письма — строки (пустая строка разделяет заявки), длинная строка
// режется по предложениям. Заявка не длиннее CHUNK_MAX_CHARS — одна часть
export function splitRequestForSearch(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= CHUNK_MAX_CHARS) return [normalized];
  return packParagraphs(
    normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

type Section = { headings: string[]; body: string };

const sameParent = (a: Section, b: Section) =>
  a.headings.slice(0, -1).join("\n") === b.headings.slice(0, -1).join("\n");

// Следующий раздел — первый подраздел этого («Уведомления» → «Уведомления › Каналы»)
const isFirstChild = (section: Section, next: Section) =>
  next.headings.length === section.headings.length + 1 &&
  section.headings.every((h, i) => next.headings[i] === h);

// Короткий раздел склеивается с разделом той же темы:
// 1) короткое вступление перед подразделами («## Уведомления» + строка, дальше «### Каналы») —
//    с первым подразделом; путь остаётся путём подраздела, название вступления в нём уже есть;
// 2) иначе — с соседом под тем же родительским заголовком: сначала с предыдущим, потом со следующим.
//    Заголовок короткого раздела остаётся строкой в тексте и добавляется в путь через запятую:
//    «Запись на занятия › Отмена записи, Мои записи».
// Подходящего раздела нет — короткий остаётся сам по себе, к чужому разделу не приклеивается.
// Подразделы проверяются первыми: иначе вступление модуля, стоящее под корнем документа,
// приклеилось бы к концу предыдущего модуля.
// Вступление хранится отдельно (lead) и всегда стоит перед заголовком подраздела: если подраздел
// сам короткий и склеится с соседом, текст будет «Вступ. ↵ П1 ↵ текст П1», а не вступление под «П1».
type MergingSection = Section & { lead: string };

const withLead = (lead: string, text: string) => (lead ? `${lead}\n\n${text}` : text);

function mergeShortSections(input: Section[]): Section[] {
  const sections: MergingSection[] = input
    .map((s) => ({ headings: [...s.headings], body: s.body.trim(), lead: "" }))
    .filter((s) => s.body.length > 0);
  const result: MergingSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (section.body.length >= SHORT_SECTION_CHARS) {
      result.push(section);
      continue;
    }
    const title = section.headings.at(-1);
    const block = withLead(section.lead, title ? `${title}\n${section.body}` : section.body);
    const prev = result.at(-1);
    const next = sections[i + 1];
    if (next && isFirstChild(section, next)) {
      next.lead = withLead(section.lead, section.body);
    } else if (prev && sameParent(prev, section)) {
      prev.body = `${prev.body}\n\n${block}`;
      if (title && prev.headings.length > 0) prev.headings[prev.headings.length - 1] += `, ${title}`;
    } else if (next && sameParent(next, section)) {
      next.body = `${block}\n\n${next.body}`;
      if (title && next.headings.length > 0) next.headings[next.headings.length - 1] = `${title}, ${next.headings.at(-1)}`;
    } else {
      result.push(section);
    }
  }
  return result.map((s) => ({ headings: s.headings, body: withLead(s.lead, s.body) }));
}

// Сравнение без регистра и знаков: «ТЗ: Лист ожидания» и файл «ТЗ Лист ожидания» — одно и то же
function sameTitle(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return key(a) === key(b);
}

function splitMarkdownSections(name: string, text: string): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let body: string[] = [];
  let inFence = false;

  const flush = () => {
    sections.push({
      // Заголовок, повторяющий имя документа (обычно # в начале файла), в путь не добавляем
      headings: stack.map((h) => h.title).filter((title) => !sameTitle(title, name)),
      body: body.join("\n"),
    });
    body = [];
  };

  for (const line of text.split("\n")) {
    // Внутри блока кода решётка — не заголовок
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (!heading) {
      body.push(line);
      continue;
    }
    flush();
    const level = heading[1].length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title: heading[2] });
  }
  flush();
  return sections;
}

function paragraphs(body: string): string[] {
  return body
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Абзацы собираются во фрагменты до предела. Следующий фрагмент того же раздела начинается
// с конца предыдущего (перекрытие), чтобы мысль на стыке не разрывалась
function packParagraphs(items: string[]): string[] {
  const pieces = items.flatMap((p) => (p.length <= CHUNK_MAX_CHARS ? [p] : splitLong(p)));
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (!current || candidate.length <= CHUNK_MAX_CHARS) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    const overlap = tail(current, CHUNK_OVERLAP_CHARS);
    const withOverlap = `${overlap}\n\n${piece}`;
    current = overlap && withOverlap.length <= CHUNK_MAX_CHARS ? withOverlap : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Абзац длиннее предела режется по предложениям, а слишком длинное предложение — по словам.
// Части чуть короче предела, чтобы к ним поместилось перекрытие
function splitLong(paragraph: string): string[] {
  const limit = CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS;
  const units = paragraph.split(/(?<=[.!?…])\s+/).flatMap((sentence) => {
    if (sentence.length <= limit) return [sentence];
    const words: string[] = [];
    let line = "";
    for (const word of sentence.split(/\s+/)) {
      if (line && line.length + 1 + word.length > limit) {
        words.push(line);
        line = "";
      }
      // Слово длиннее предела (например, длинная ссылка) режется как есть
      for (let w = word; w.length > 0; w = w.slice(limit)) {
        const part = w.slice(0, limit);
        line = line ? `${line} ${part}` : part;
        if (line.length >= limit) {
          words.push(line);
          line = "";
        }
      }
    }
    if (line) words.push(line);
    return words;
  });

  const parts: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + 1 + unit.length > limit) {
      parts.push(current);
      current = unit;
    } else {
      current = current ? `${current} ${unit}` : unit;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Конец текста длиной не больше max: с начала предложения, если оно есть в первой половине,
// иначе с границы слова
function tail(text: string, max: number): string {
  if (text.length <= max) return "";
  const slice = text.slice(-max);
  const sentence = /[.!?…]\s+/.exec(slice);
  if (sentence && sentence.index < max / 2) return slice.slice(sentence.index + sentence[0].length).trim();
  const space = slice.search(/\s/);
  return space === -1 ? "" : slice.slice(space).trim();
}
