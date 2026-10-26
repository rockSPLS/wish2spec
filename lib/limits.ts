// Лимиты размера и тексты сообщений при их превышении. Общие для страницы и сервера:
// страница проверяет до отправки, сервер — ещё раз (lib/input.ts), с теми же словами.

export const LIMITS = {
  documentNameChars: 200,
  documentChars: 500_000, // примерно 250 страниц текста; для PDF и DOCX — извлечённый текст
  fileBytes: 10 * 1024 * 1024, // один файл PDF или DOCX
  uploadFileBytes: 25 * 1024 * 1024, // все файлы PDF и DOCX одной загрузки
  documentsPerUpload: 20,
  documentsTotal: 200,
  requestChars: 5_000,
  requestsPerAdd: 300,
  requestsTotal: 5_000,
};

// 5000 → «5000», 500000 → «500 000»: четырёхзначные числа без пробела, как принято в русском тексте
export function formatNumber(n: number): string {
  return n < 10_000 ? String(n) : n.toLocaleString("ru-RU").replace(/\s/g, " ");
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} МБ`;

export const LIMIT_MESSAGES = {
  requestTooLong: (n: number) => `Заявка ${n} длиннее ${formatNumber(LIMITS.requestChars)} символов — сократите её.`,
  requestEmpty: (n: number) => `Заявка ${n} пустая.`,
  tooManyRequests: (count: number) =>
    `За раз можно добавить не больше ${formatNumber(LIMITS.requestsPerAdd)} заявок, а найдено ${formatNumber(count)}. Добавьте их в несколько приёмов.`,
  requestsTotal: (after: number) =>
    `Заявок в списке может быть не больше ${formatNumber(LIMITS.requestsTotal)}, а с новыми их стало бы ${formatNumber(after)}.`,
  documentTooLong: (name: string) =>
    `Документ «${name}» длиннее ${formatNumber(LIMITS.documentChars)} символов — разделите его на части.`,
  documentNameTooLong: (n: number) => `Название документа ${n} длиннее ${LIMITS.documentNameChars} символов.`,
  fileTooBig: (name: string) =>
    `Файл «${name}» больше ${mb(LIMITS.fileBytes)} — разделите его на части или сохраните без картинок.`,
  uploadTooBig: () =>
    `Файлы PDF и DOCX за одну загрузку — не больше ${mb(LIMITS.uploadFileBytes)} вместе. Загрузите их в несколько приёмов.`,
  tooManyDocuments: (count: number) =>
    `За раз можно загрузить не больше ${LIMITS.documentsPerUpload} документов, а выбрано ${count}. Загрузите их в несколько приёмов.`,
  documentsTotal: (after: number) =>
    `Документов может быть не больше ${LIMITS.documentsTotal}, а с этой загрузкой их стало бы ${after}. Удалите ненужные в шаге 1.`,
};
