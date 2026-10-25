// Разбиение вставленного текста на входящие заявки (используется на странице до отправки).
// Заявки разделяются пустой строкой; внутри заявки переносы строк допустимы.
// Если пустых строк нет (обычно это столбец из таблицы) — каждая строка отдельная заявка.

export function splitRequests(input: string): string[] {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const hasBlankLine = /\n[ \t]*\n/.test(text);
  const parts = hasBlankLine ? text.split(/\n[ \t]*\n/) : text.split("\n");
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
