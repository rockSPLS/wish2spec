// Разбиение вставленного текста на входящие заявки (используется на странице до отправки).
// Заявки разделяются пустой строкой; внутри заявки переносы строк допустимы.
// Если пустых строк нет (обычно это столбец из таблицы) — каждая строка отдельная заявка.

const BLANK_LINE = /\n[ \t]*\n/;

// Пустых строк нет, а строк несколько — каждая строка станет отдельной заявкой
export function splitsByLines(input: string): boolean {
  const text = input.replace(/\r\n?/g, "\n").trim();
  return text.includes("\n") && !BLANK_LINE.test(text);
}

export function splitRequests(input: string): string[] {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const parts = BLANK_LINE.test(text) ? text.split(BLANK_LINE) : text.split("\n");
  return parts
    .map((part) =>
      part
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim(),
    )
    .filter((part) => part.length > 0);
}
