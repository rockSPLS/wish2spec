"use client";

import { ChevronRight, FilePlus, FolderOpen, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import type { DocumentSummary, IncomingRequest } from "@/lib/types";
import { callApi, plural } from "./api";
import { Hint } from "./hint";
import { Progress } from "./progress";
import {
  BUTTON_SECONDARY,
  DANGER_LINK,
  ERROR,
  FILE_BUTTON,
  FILE_BUTTON_BUSY,
  HINT,
  ICON,
  INPUT,
  TOGGLE,
  SECTION,
  STEP_NUMBER,
  STEP_TITLE,
} from "./ui";

// .md и .txt уходят на сервер текстом, PDF и DOCX — файлом в base64: разбирает их сервер (lib/extract.ts)
type Upload =
  | { name: string; format: "md" | "txt"; text: string }
  | { name: string; format: "pdf" | "docx"; data: string };

// Шаг 1. Документация системы: загрузка .md, .txt, .pdf и .docx, вставка текста, список и удаление.
// Пока нет ни документов, ни заявок, — ещё и «Загрузить демо-данные».
// Шаг компактный: «Вставить текст» и список документов свёрнуты, чтобы шаг 3 был виден на первом экране

const FILE_PATTERN = /^(.*)\.(md|markdown|txt|pdf|docx)$/i;

// Почему кнопки неактивны во время загрузки — при наведении; рядом и так видна строка о процессе
const LOADING_HINT = "Дождитесь конца загрузки.";

// Файл → base64 без префикса «data:…;base64,»
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Не удалось прочитать файл «${file.name}».`));
    reader.readAsDataURL(file);
  });
}

export function DocumentsStep({
  documents,
  onChange,
  canLoadDemo,
  onDemoLoaded,
}: {
  documents: DocumentSummary[];
  onChange: (documents: DocumentSummary[]) => void;
  canLoadDemo: boolean;
  onDemoLoaded: (data: { documents: DocumentSummary[]; requests: IncomingRequest[] }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Список документов свёрнут за строкой-сводкой
  const [listOpen, setListOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");

  // Возвращает текст ошибки или null; показывает его вызывающая функция — вместе с другими сообщениями
  async function upload(items: Upload[]): Promise<string | null> {
    setError(null);
    setBusy(
      "Индексирую документы… В первый раз скачивается модель эмбеддингов (около 135 МБ), это может занять пару минут.",
    );
    try {
      const data = await callApi<{ documents: DocumentSummary[] }>("/api/documents", {
        method: "POST",
        body: { documents: items },
      });
      onChange(data.documents);
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      setBusy(null);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const items: Upload[] = [];
    const skipped: string[] = [];
    // Лимиты — те же, что проверяет сервер (lib/limits.ts); здесь — до отправки
    const problems: string[] = [];
    let fileBytes = 0;
    for (const file of Array.from(files)) {
      const match = FILE_PATTERN.exec(file.name);
      if (!match) {
        skipped.push(file.name);
        continue;
      }
      const name = match[1];
      const ext = match[2].toLowerCase();
      if (ext === "pdf" || ext === "docx") {
        if (file.size > LIMITS.fileBytes) {
          problems.push(LIMIT_MESSAGES.fileTooBig(file.name));
          continue;
        }
        fileBytes += file.size;
        items.push({ name, format: ext, data: await readBase64(file) });
      } else {
        const text = await file.text();
        if (text.length > LIMITS.documentChars) {
          problems.push(LIMIT_MESSAGES.documentTooLong(file.name));
          continue;
        }
        items.push({ name, format: ext === "txt" ? "txt" : "md", text });
      }
    }
    // Слишком много за раз — не загружаем ничего, чтобы аналитик сам выбрал, что загрузить первым
    if (items.length > LIMITS.documentsPerUpload) {
      problems.push(LIMIT_MESSAGES.tooManyDocuments(items.length));
      items.length = 0;
    } else if (fileBytes > LIMITS.uploadFileBytes) {
      problems.push(LIMIT_MESSAGES.uploadTooBig());
      items.length = 0;
    }
    if (items.length > 0) {
      const uploadError = await upload(items);
      if (uploadError) problems.push(uploadError);
    }
    if (skipped.length > 0) {
      problems.push(`Пропущены файлы не в формате .md, .txt, .pdf или .docx: ${skipped.join(", ")}.`);
    }
    setError(problems.length > 0 ? problems.join("\n") : null);
  }

  async function onPaste() {
    // Вставленный текст разбирается как Markdown: если заголовков нет, он режется по абзацам, как .txt
    const uploadError = await upload([{ name: pasteName.trim(), format: "md", text: pasteText }]);
    setError(uploadError);
    if (!uploadError) {
      setPasteName("");
      setPasteText("");
    }
  }

  // Демо-данные: документы индексируются на сервере тем же кодом, что при обычной загрузке.
  // Обработку кнопка не запускает — модель вызывается по «Обработать»
  async function onDemo() {
    setError(null);
    setBusy(
      "Загружаю демо-данные… В первый раз скачивается модель эмбеддингов (около 135 МБ), это может занять пару минут.",
    );
    try {
      const data = await callApi<{ documents: DocumentSummary[]; requests: IncomingRequest[] }>("/api/demo", {
        method: "POST",
        body: {},
      });
      onDemoLoaded(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Один документ по названию или все сразу («Удалить все документы» — документы и индекс)
  async function onDelete(target: { name: string } | { all: true }) {
    const question =
      "name" in target
        ? `Удалить документ «${target.name}»?`
        : `Удалить все документы (${documents.length}) вместе с индексом? Готовые результаты заявок останутся — источники в них сохранены. Новые заявки не обработать, пока не загрузите документы снова.`;
    if (!window.confirm(question)) return;
    setError(null);
    try {
      const data = await callApi<{ documents: DocumentSummary[] }>("/api/documents", {
        method: "DELETE",
        body: target,
      });
      onChange(data.documents);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const empty = documents.length === 0;
  const chunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);

  return (
    <section className={SECTION} aria-labelledby="step-documents">
      <h2 id="step-documents" className={STEP_TITLE}>
        <span className={STEP_NUMBER}>1</span>
        <span className="sr-only">. </span>
        Документация системы
      </h2>

      {/* Порядок — как в шаге 2: кнопка загрузки, подсказка, ручной ввод. Так кнопки загрузки
          двух шагов стоят на одном уровне */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Во время загрузки подпись выглядит как неактивная кнопка и не ловит мышь — наведение
            достаётся обёртке с подсказкой, курсор со знаком вопроса — у неё же */}
        <Hint hint={busy ? LOADING_HINT : undefined} className={busy ? "cursor-help" : ""}>
          <label className={busy ? FILE_BUTTON_BUSY : FILE_BUTTON}>
            <Upload {...ICON} />
            Загрузить файлы
            <input
              type="file"
              multiple
              accept=".md,.markdown,.txt,.pdf,.docx"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </Hint>
        {empty && canLoadDemo && (
          <Hint hint={busy ? LOADING_HINT : undefined}>
            <button type="button" className={BUTTON_SECONDARY} disabled={!!busy} onClick={() => void onDemo()}>
              <FolderOpen {...ICON} />
              Загрузить демо-данные
            </button>
          </Hint>
        )}
      </div>
      {empty ? (
        // Пустой шаг подсказывает, что загрузить; пример — только пока нет и заявок (тогда видна кнопка)
        <>
          <p className="text-sm">
            Загрузите справку, прежние ТЗ, список задач и глоссарий своей системы.
            {canLoadDemo && " Или посмотрите, как это работает, на примере студии йоги."}
          </p>
          <p className={HINT}>Файлы .md, .txt, .pdf и .docx. PDF нужен с текстом: скан без текстового слоя не прочитается.</p>
        </>
      ) : (
        <p className={HINT}>Справка, прежние ТЗ, список задач, глоссарий — .md, .txt, .pdf, .docx.</p>
      )}

      <details className="group text-sm">
        <summary className={`${TOGGLE} list-none [&::-webkit-details-marker]:hidden`}>
          <ChevronRight size={16} aria-hidden className="shrink-0 group-open:rotate-90 motion-safe:transition-transform" />
          Вставить текст
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <input
            className={INPUT}
            placeholder="Название документа"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
          />
          <textarea
            className={`${INPUT} min-h-32`}
            placeholder="Текст документа. Заголовки Markdown (#, ##) помогут разбить его на разделы."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <Hint
            hint={
              busy
                ? LOADING_HINT
                : !pasteName.trim() || !pasteText.trim()
                  ? "Введите название и текст документа."
                  : undefined
            }
          >
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={!!busy || !pasteName.trim() || !pasteText.trim()}
              onClick={() => void onPaste()}
            >
              <FilePlus {...ICON} />
              Добавить к документам
            </button>
          </Hint>
        </div>
      </details>

      {busy && <Progress>{busy}</Progress>}
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}

      {/* Что загружено — одной строкой; по нажатию — список с «Удалить» и «Удалить все документы» */}
      {!empty && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={TOGGLE}
            aria-expanded={listOpen}
            // Список есть в разметке только раскрытым — ссылка на него тоже
            aria-controls={listOpen ? "documents-list" : undefined}
            onClick={() => setListOpen((open) => !open)}
          >
            <ChevronRight
              size={16}
              aria-hidden
              className={`shrink-0 motion-safe:transition-transform ${listOpen ? "rotate-90" : ""}`}
            />
            {documents.length} {plural(documents.length, ["документ", "документа", "документов"])}, {chunks}{" "}
            {plural(chunks, ["фрагмент", "фрагмента", "фрагментов"])}
          </button>
          {listOpen && (
            <div id="documents-list" className="flex flex-col gap-2">
              {/* До 8 строк, дальше — прокрутка внутри: шаг 3 остаётся на первом экране и при раскрытом
                  списке, а «Удалить все документы» под списком всегда видна */}
              <ul className="flex max-h-75 flex-col divide-y divide-line overflow-y-auto text-sm">
                {documents.map((d) => (
                  <li key={d.name} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words">{d.name}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-muted">
                        {d.chunkCount} {plural(d.chunkCount, ["фрагмент", "фрагмента", "фрагментов"])}
                      </span>
                      <Hint hint={busy ? LOADING_HINT : undefined} align="end">
                        <button
                          type="button"
                          className={DANGER_LINK}
                          disabled={!!busy}
                          onClick={() => void onDelete({ name: d.name })}
                        >
                          <Trash2 size={14} aria-hidden />
                          Удалить
                        </button>
                      </Hint>
                    </span>
                  </li>
                ))}
              </ul>
              <Hint hint={busy ? LOADING_HINT : undefined} className="w-fit">
                <button
                  type="button"
                  className={DANGER_LINK}
                  disabled={!!busy}
                  onClick={() => void onDelete({ all: true })}
                >
                  <Trash2 size={14} aria-hidden />
                  Удалить все документы
                </button>
              </Hint>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
