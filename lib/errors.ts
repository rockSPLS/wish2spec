import { AISDKError, APICallError, NoObjectGeneratedError, RetryError } from "ai";
import { ConfigError } from "./config";

// Тексты ошибок для аналитика. Ответ сервиса модели как есть аналитику ничего не говорит,
// поэтому в строке заявки и в карточке — обобщённая причина и что сделать (подробнее — журнал решений,
// «Инструменты аналитика»).
// Маршрут проверки подключений показывает ответ сервиса как есть — он нужен при настройке (errorText).

type ServiceErrorKind = "rateLimit" | "key" | "unavailable" | "other";

// У заявки и основы ТЗ рядом есть кнопка «Повторить»
export const SERVICE_ERRORS: Record<ServiceErrorKind, string> = {
  rateLimit: "Сервис модели ответил «слишком много запросов». Подождите минуту и нажмите «Повторить».",
  key: "Сервис не принял ключ. Проверьте локальные настройки.",
  unavailable: "Сервис модели сейчас не отвечает. Нажмите «Повторить» чуть позже.",
  other:
    "Сервис модели ответил ошибкой. Нажмите «Повторить». Если ошибка повторится, проверьте настройки модели через маршрут проверки подключений.",
};

// Загрузка документов в режиме EMBEDDINGS_MODE=api: эмбеддинги считает тот же сервис.
// Кнопки «Повторить» в шаге 1 нет — документы загружают снова
const DOCUMENT_SERVICE_ERRORS: Record<ServiceErrorKind, string> = {
  rateLimit: "Сервис модели ответил «слишком много запросов». Подождите минуту и загрузите документы снова.",
  key: SERVICE_ERRORS.key,
  unavailable: "Сервис модели сейчас не отвечает. Загрузите документы снова чуть позже.",
  other:
    "Сервис модели ответил ошибкой. Если ошибка повторится, проверьте настройки модели через маршрут проверки подключений.",
};

// Непредвиденная ошибка в самом приложении: текст ошибки — в терминале запуска, где выполнена
// команда npm run dev (logError)
const UNEXPECTED_ERRORS = {
  process: "Не удалось обработать заявку. Нажмите «Повторить». Если ошибка повторится, текст ошибки — в терминале запуска.",
  spec: "Не удалось подготовить основу ТЗ. Нажмите «Повторить». Если ошибка повторится, текст ошибки — в терминале запуска.",
};

// Заявка занята обработкой или подготовкой основы ТЗ — ответ 409
export const REQUEST_BUSY = "Заявка сейчас обрабатывается. Дождитесь конца обработки.";

// Ошибка, текст которой уже написан для аналитика (например, «Документация системы не загружена…»)
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

// Текст ошибки как есть — для маршрутов при настройке и замерах
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serviceErrorKind(error: AISDKError): ServiceErrorKind {
  // После повторов AI SDK бросает RetryError — причина в последней попытке
  const cause = RetryError.isInstance(error) && AISDKError.isInstance(error.lastError) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    if (status === 429) return "rateLimit";
    // 403 сюда не входит: сервисы отвечают им и по другим причинам (например, модель недоступна
    // или текст не прошёл модерацию) — это общий текст с советом проверить настройки
    if (status === 401) return "key";
    // Без кода — сервис не ответил вовсе: сеть, адрес недоступен, обрыв по времени
    // (сбой fetch AI SDK оборачивает в APICallError без кода)
    if (status === undefined || status === 408 || status >= 500) return "unavailable";
  }
  return "other";
}

// Запись об ошибке в терминал запуска: по ней разбираются с настройками.
// У ошибки сервиса — только текст ошибки, код ответа и адрес. Ни тела запроса (в нём текст заявки
// и фрагменты документов, в режиме api при загрузке — весь документ), ни тела ответа (сервис может
// повторить в нём присланный текст). Ключ в ошибку не попадает.
// Прочие ошибки AI SDK — только имя, а у ответа не по схеме — ещё общий текст и причина остановки:
// в самих объектах лежит ответ модели, а в тексте ошибки проверки схемы — проверенное значение
export function logError(error: unknown): void {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    console.error(error instanceof Error ? error.message : String(error), {
      statusCode: cause.statusCode,
      url: cause.url,
    });
  } else if (NoObjectGeneratedError.isInstance(cause)) {
    console.error(`${cause.name}: ${cause.message}`, { finishReason: cause.finishReason });
  } else if (AISDKError.isInstance(cause)) {
    console.error(cause.name);
  } else if (RetryError.isInstance(error)) {
    // Повторы закончились ошибкой не из AI SDK: в объекте — ответы прежних попыток
    console.error(error.name, { reason: error.reason });
  } else console.error(error);
}

// Понятный текст ошибки для строки заявки и карточки; action — что делали: обработку или основу ТЗ
export function userErrorText(error: unknown, action: "process" | "spec" = "process"): string {
  if (error instanceof UserError || error instanceof ConfigError) return error.message;
  logError(error);
  if (AISDKError.isInstance(error)) return SERVICE_ERRORS[serviceErrorKind(error)];
  return UNEXPECTED_ERRORS[action];
}

// Ошибка сервиса при загрузке документов (режим api) — понятным текстом; null — ошибка не от сервиса
export function documentServiceErrorText(error: unknown): string | null {
  if (!AISDKError.isInstance(error)) return null;
  logError(error);
  return DOCUMENT_SERVICE_ERRORS[serviceErrorKind(error)];
}
