"use client";

import { ListPlus, TriangleAlert, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { splitRequests } from "@/lib/split-requests";
import type { IncomingRequest } from "@/lib/types";
import { callApi, plural } from "./api";
import { Hint } from "./hint";
import { BUTTON, ERROR, FILE_BUTTON_SECONDARY, HINT, ICON, INPUT, SECTION, STEP_NUMBER, STEP_TITLE } from "./ui";

// Шаг 2. Входящие заявки: загрузка .txt или вставка, «Найдено N» и список до добавления

// Что уходит в сервис языковой модели (текст выбран владельцем, см. журнал решений, «Приватность»).
// В режиме api в сервис уходят ещё и все фрагменты документов — для эмбеддингов
const SERVICE_NOTICE = {
  local:
    "В сервис языковой модели уходят текст заявки (полностью) и найденные к ней фрагменты загруженных документов. Уберите из них личные данные и секреты, если их нельзя передавать этому сервису.",
  api: "В сервис языковой модели уходят текст заявки (полностью), найденные к ней фрагменты загруженных документов, а при загрузке — все фрагменты, чтобы рассчитать эмбеддинги. Уберите из них личные данные и секреты, если их нельзя передавать этому сервису.",
};

// Лимиты — те же, что проверяет сервер (lib/limits.ts); здесь — до отправки, чтобы сразу назвать заявку
function limitProblems(found: string[]): string[] {
  if (found.length > LIMITS.requestsPerAdd) return [LIMIT_MESSAGES.tooManyRequests(found.length)];
  return found.flatMap((item, i) => (item.length > LIMITS.requestChars ? [LIMIT_MESSAGES.requestTooLong(i + 1)] : []));
}

export function RequestsStep({
  onAdded,
  embeddingsMode,
}: {
  onAdded: (requests: IncomingRequest[]) => void;
  embeddingsMode: "local" | "api";
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useMemo(() => splitRequests(text), [text]);
  const problems = useMemo(() => limitProblems(found), [found]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const texts = await Promise.all(Array.from(files).map((f) => f.text()));
    // Текст файла добавляется к уже вставленному через пустую строку — это граница заявок
    setText((current) => [current.trim(), ...texts.map((t) => t.trim())].filter(Boolean).join("\n\n"));
  }

  async function onAdd() {
    setError(null);
    setBusy(true);
    try {
      const data = await callApi<{ requests: IncomingRequest[] }>("/api/requests", {
        method: "POST",
        body: { texts: found },
      });
      onAdded(data.requests);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={SECTION} aria-labelledby="step-requests">
      <h2 id="step-requests" className={STEP_TITLE}>
        <span className={STEP_NUMBER}>2</span>
        <span className="sr-only">. </span>
        Входящие заявки
      </h2>
      <p className={HINT}>
        Заявки разделяются пустой строкой. Если пустых строк нет, каждая строка — отдельная заявка.
      </p>

      <label className={FILE_BUTTON_SECONDARY}>
        <Upload {...ICON} />
        Загрузить .txt
        <input
          type="file"
          multiple
          accept=".txt,text/plain"
          className="sr-only"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <textarea
        className={`${INPUT} min-h-32`}
        placeholder="Вставьте заявки из почты, чата или таблицы"
        aria-label="Текст входящих заявок"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {found.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Найдено {found.length}</p>
          <ol className="flex max-h-48 list-decimal flex-col gap-1 overflow-y-auto pl-6 text-sm">
            {found.map((item, i) => (
              <li key={i}>
                {/* line-clamp на самом li убрал бы номер пункта — поэтому внутренний span */}
                <span className="line-clamp-2 whitespace-pre-line break-words">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {problems.length > 0 && (
        <p className={ERROR} role="alert">
          {problems.join("\n")}
        </p>
      )}

      {/* Почему кнопка неактивна — подсказкой при наведении; если не так с самими заявками — сообщение выше */}
      <Hint hint={found.length === 0 ? "Вставьте заявки в поле или загрузите .txt." : undefined}>
        <button
          type="button"
          className={BUTTON}
          disabled={busy || found.length === 0 || problems.length > 0}
          onClick={() => void onAdd()}
        >
          <ListPlus {...ICON} />
          {found.length > 0
            ? `Добавить ${found.length} ${plural(found.length, ["заявку", "заявки", "заявок"])} в список`
            : "Добавить в список"}
        </button>
      </Hint>

      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}

      {/* Нейтральная строка: жёлтый блок совпал бы с ярлыком «Требуется уточнение», внимание несёт значок */}
      <p className={`flex items-start gap-2 ${HINT}`}>
        <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-warning" />
        <span>{SERVICE_NOTICE[embeddingsMode]}</span>
      </p>
    </section>
  );
}
