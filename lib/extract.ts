import "server-only";
import { constants as zlibConstants, inflateSync } from "node:zlib";
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";

// Текст из файлов PDF и DOCX. Разбор — на сервере: библиотеки не попадают в код страницы,
// а проверка размера и формата — в одном месте с остальной проверкой ввода (почему так — в журнале решений).
// DOCX → текст с заголовками Markdown (# Раздел), дальше нарезка как у Markdown.
// PDF → текст по абзацам: разметки заголовков в PDF нет, нарезка — как у .txt.

// Ошибка разбора с понятным текстом для аналитика
export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

// --- DOCX ---

// Заголовки Word (стили «Заголовок 1…6») mammoth превращает в <h1>…<h6>; стиль «Название» — тоже в заголовок
const DOCX_STYLE_MAP = ["p[style-name='Title'] => h1:fresh"];

// DOCX — это ZIP, и специально сделанный файл в несколько мегабайт мог бы при распаковке
// развернуться в гигабайты и занять всю память. Размеры частей после распаковки записаны
// в оглавлении ZIP — их можно сложить до разбора. Картинки (word/media) не считаются:
// разбор их не распаковывает (см. convertImage ниже). Обычный документ даже на 500 000 символов
// занимает в распакованном виде несколько десятков мегабайт разметки
const DOCX_MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

// Сумма размеров после распаковки по оглавлению ZIP; null — оглавление не прочитать
function docxUnpackedBytes(buffer: Buffer): number | null {
  // Конец оглавления — запись с подписью 0x06054b50 в последних 22 байтах + до 64 КБ комментария
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    // 0xFFFFFFFF — размер не помещается в 4 байта (ZIP64): заведомо больше предела
    if (size === 0xffffffff) return Infinity;
    if (!name.startsWith("word/media/")) total += size;
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return total;
}

// Картинки в текст не попадают — разбор не распаковывает их вовсе
const SKIP_IMAGES = mammoth.images.imgElement(() => Promise.resolve({ src: "" }));

export async function docxToMarkdown(fileName: string, buffer: Buffer): Promise<string> {
  const unpacked = docxUnpackedBytes(buffer);
  if (unpacked !== null && unpacked > DOCX_MAX_UNPACKED_BYTES) {
    throw new ExtractError(
      `Файл «${fileName}» при распаковке занимает больше ${Math.round(DOCX_MAX_UNPACKED_BYTES / (1024 * 1024))} МБ — у обычного документа так не бывает. Сохраните его в Word заново или загрузите по частям.`,
    );
  }
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer }, { styleMap: DOCX_STYLE_MAP, convertImage: SKIP_IMAGES })).value;
  } catch {
    throw new ExtractError(`Файл «${fileName}» не удалось прочитать как DOCX. Сохраните его в Word заново или загрузите текстом.`);
  }
  return htmlToMarkdown(html);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]);
}

// Одна строка без разметки: границы абзацев, пунктов и переносы — пробел, остальные теги убираются
// (внутри слова: «сло<strong>во</strong>» → «слово»), пробелы схлопываются. Сущности не раскодируются —
// это делается один раз для всего текста
function oneLine(html: string): string {
  return html
    .replace(/<\/?(p|li|ul|ol|br)\b[^>]*>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Метка строки-заголовка: такие строки не экранируются
const HEADING_MARK = "\u0001";

// Обычная строка, которую нарезка Markdown приняла бы за разметку: «# текст» — за заголовок,
// «```» или «~~~» — за начало блока кода (тогда все следующие заголовки пропали бы)
function escapeLine(line: string): string {
  return line.replace(/^(#+)(\s)/, "$1 ").replace(/^(```|~~~)/, "​$1");
}

// HTML от mammoth простой: заголовки, абзацы, списки (бывают вложенные), таблицы.
// Заголовок — строка «## Текст», абзац и пункт списка — отдельные абзацы, перенос строки
// внутри абзаца (Shift+Enter) — перенос, строка таблицы — ячейки через « | »
function htmlToMarkdown(html: string): string {
  const text = html
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g, (_, row: string) => {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => oneLine(c[1])).filter(Boolean);
      return `\n\n${cells.join(" | ")}\n\n`;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, level: string, title: string) => {
      const line = oneLine(title);
      return line ? `\n\n${HEADING_MARK}${"#".repeat(Number(level))} ${line}\n\n` : "\n\n";
    })
    .replace(/<br\b[^>]*>/g, "\n")
    .replace(/<\/?(p|li|ul|ol|table|thead|tbody)\b[^>]*>/g, "\n\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split(/\n[ \t]*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((line) => (line.startsWith(HEADING_MARK) ? line.slice(1) : escapeLine(line)))
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

// --- PDF ---

type PdfTextItem = { str: string; transform: number[]; hasEOL: boolean };

// Расстояние между строками больше обычного во столько раз — начало нового абзаца
const PARAGRAPH_GAP = 1.4;
// Шаг строки внутри абзаца редко больше 1,25 размера шрифта (межстрочный интервал до 1,25)
const LINE_STEP = 1.25;

// Сжатые части PDF тоже могут развернуться в гигабайты, а их размер после распаковки в файле не записан.
// Поэтому до разбора код сам распаковывает каждую часть («stream … endstream») с общим пределом и
// останавливается, как только предел превышен. Проверяется стандартное сжатие PDF (Flate); части,
// сжатые иначе или зашифрованные, пропускаются — они в «Осознанно не закрыто» журнала решений.
// Картинки тоже пропускаются: текст из PDF извлекается без их распаковки
const PDF_MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

function pdfUnpacksTooBig(data: Uint8Array): boolean {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let total = 0;
  let pos = 0;
  for (;;) {
    const keyword = buffer.indexOf("stream", pos, "latin1");
    if (keyword < 0) return false;
    pos = keyword + 6;
    if (keyword >= 3 && buffer.toString("latin1", keyword - 3, keyword) === "end") continue;
    // Словарь части — между «obj» и словом stream. Картинки не считаются: при извлечении текста
    // pdf.js их не распаковывает, а справка со скриншотами иначе не прошла бы проверку
    const objStart = buffer.lastIndexOf(" obj", keyword, "latin1");
    const dictionary = buffer.toString("latin1", Math.max(objStart, keyword - 4096, 0), keyword);
    const isImage = /\/Subtype\s*\/Image\b/.test(dictionary);
    // Данные начинаются после перевода строки за словом stream
    let start = keyword + 6;
    if (buffer[start] === 13) start++;
    if (buffer[start] === 10) start++;
    const end = buffer.indexOf("endstream", start, "latin1");
    if (end < 0) return false;
    pos = end + 9;
    if (isImage) continue;
    try {
      total += inflateSync(buffer.subarray(start, end), {
        maxOutputLength: PDF_MAX_UNPACKED_BYTES - total + 1,
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
      }).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") return true;
      // Не Flate или зашифровано — такую часть не проверить, пропускаем
    }
    if (total > PDF_MAX_UNPACKED_BYTES) return true;
  }
}

export async function pdfToText(fileName: string, data: Uint8Array): Promise<string> {
  const unreadable = () => new ExtractError(`Файл «${fileName}» не удалось прочитать как PDF.`);
  if (pdfUnpacksTooBig(data)) {
    throw new ExtractError(
      `Файл «${fileName}» при распаковке занимает больше ${Math.round(PDF_MAX_UNPACKED_BYTES / (1024 * 1024))} МБ — у обычного документа так не бывает. Загрузите его по частям или текстом.`,
    );
  }
  let pdf;
  try {
    // isEvalSupported: false — PDF не может выполнить свой код при разборе шрифтов
    pdf = await getDocumentProxy(data, { isEvalSupported: false });
  } catch (error) {
    if ((error as Error).name === "PasswordException") {
      throw new ExtractError(`Файл «${fileName}» защищён паролем. Снимите защиту и загрузите файл снова.`);
    }
    throw unreadable();
  }
  try {
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      // Файл открылся, но страница повреждена — то же понятное сообщение, а не текст библиотеки
      const content = await pdf
        .getPage(p)
        .then((page) => page.getTextContent())
        .catch(() => {
          throw unreadable();
        });
      const items = (content.items as Partial<PdfTextItem>[]).filter((i): i is PdfTextItem => typeof i.str === "string");
      pages.push(pageParagraphs(items));
    }
    const text = pages.filter(Boolean).join("\n\n");
    // Текстового слоя нет — скорее всего, это скан: распознавать текст на картинках Wish2Spec не умеет
    if (!/\p{L}/u.test(text)) {
      throw new ExtractError(
        `В файле «${fileName}» нет текста — похоже, это скан. Распознавание текста на картинках Wish2Spec не делает: загрузите PDF с текстовым слоем или текст документа.`,
      );
    }
    return text;
  } finally {
    await pdf.destroy();
  }
}

// Строки страницы собираются в абзацы: новый абзац — там, где расстояние до предыдущей строки
// заметно больше обычного шага строки
function pageParagraphs(items: PdfTextItem[]): string {
  const lines: { text: string; y: number; size: number }[] = [];
  let current = "";
  let y: number | null = null;
  let size = 0;
  const flush = () => {
    if (current.trim() && y !== null) lines.push({ text: current.trim(), y, size });
    current = "";
    y = null;
    size = 0;
  };
  for (const item of items) {
    if (item.str.trim()) {
      if (y === null) y = item.transform[5];
      // Размер шрифта — масштаб по вертикали в матрице текста
      size = Math.max(size, Math.abs(item.transform[3]));
    }
    current += item.str;
    if (item.hasEOL) flush();
  }
  flush();
  if (lines.length === 0) return "";

  // Обычный шаг строки — нижняя четверть промежутков, но не больше 1,25 размера шрифта:
  // если почти все абзацы в одну строку, промежутков внутри абзацев мало, и нижняя четверть
  // попала бы на промежутки между абзацами
  const gaps = lines.slice(1).map((line, i) => lines[i].y - line.y).filter((g) => g > 0);
  const quarter = gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)] : 0;

  const paragraphs: string[] = [];
  let paragraph = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    const fontStep = lines[i - 1].size * LINE_STEP;
    const usual = fontStep > 0 && quarter > 0 ? Math.min(quarter, fontStep) : quarter || fontStep;
    // Переход вверх (gap ≤ 0: новая колонка или страница) и большой отступ — граница абзаца
    if (usual > 0 && (gap > usual * PARAGRAPH_GAP || gap <= 0)) {
      paragraphs.push(paragraph);
      paragraph = lines[i].text;
    } else {
      // Перенос слова по дефису склеивается без пробела: «онлайн-» + «оплата»
      paragraph = /\p{L}-$/u.test(paragraph) ? `${paragraph}${lines[i].text}` : `${paragraph} ${lines[i].text}`;
    }
  }
  paragraphs.push(paragraph);
  return paragraphs.join("\n\n");
}
