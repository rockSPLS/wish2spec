"use client";

import { ChevronRight, ListPlus, TriangleAlert, Upload, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LIMIT_MESSAGES, LIMITS } from "@/lib/limits";
import { splitRequests, splitsByLines } from "@/lib/split-requests";
import type { IncomingRequest } from "@/lib/types";
import { callApi, plural } from "./api";
import { Hint } from "./hint";
import {
  BUTTON,
  ERROR,
  FILE_BUTTON_SECONDARY,
  HINT,
  ICON,
  INPUT,
  LINK_BUTTON,
  SECTION,
  STEP_NUMBER,
  STEP_TITLE,
  TOGGLE,
} from "./ui";

// Шаг 2. Входящие заявки: загрузка .txt (заявки из файла — списком до добавления) или вставка в поле.
// Поле — в три строки и растёт при вводе, чтобы шаг 3 был виден на первом экране

// Что уходит в сервис языковой модели (текст выбран владельцем, см. журнал решений, «Приватность»).
// В режиме api в сервис уходят ещё и все фрагменты документов — для эмбеддингов
const SERVICE_NOTICE = {
  local:
    "В сервис языковой модели уходят текст заявки (полностью) и найденные к ней фрагменты загруженных документов. Уберите из них личные данные и секреты, если их нельзя передавать этому сервису.",
  api: "В сервис языковой модели уходят текст заявки (полностью), найденные к ней фрагменты загруженных документов, а при загрузке — все фрагменты, чтобы рассчитать эмбеддинги. Уберите из них личные данные и секреты, если их нельзя передавать этому сервису.",
};

// Заявки одного загруженного файла
type LoadedFile = { name: string; items: string[] };

// Лимиты — те же, что проверяет сервер (lib/limits.ts); здесь — до отправки, чтобы сразу назвать
// заявку и где она: в каком файле или в поле. Номер — свой у каждого файла и у поля
function limitProblems(loaded: LoadedFile[], typed: string[]): string[] {
  const count = loaded.reduce((sum, file) => sum + file.items.length, 0) + typed.length;
  if (count > LIMITS.requestsPerAdd) {
    return [
      loaded.length > 0
        ? LIMIT_MESSAGES.tooManyRequestsWithFiles(count, loaded.length)
        : LIMIT_MESSAGES.tooManyRequests(count),
    ];
  }
  const tooLong = (items: string[], message: (n: number) => string) =>
    items.flatMap((item, i) => (item.length > LIMITS.requestChars ? [message(i + 1)] : []));
  return [
    ...loaded.flatMap((file) => tooLong(file.items, (n) => LIMIT_MESSAGES.fileRequestTooLong(n, file.name))),
    ...tooLong(typed, LIMIT_MESSAGES.typedRequestTooLong),
  ];
}

const fileList = (names: string[]) => names.map((name) => `«${name}»`).join(", ");

export function RequestsStep({
  onAdded,
  embeddingsMode,
}: {
  onAdded: (requests: IncomingRequest[]) => void;
  embeddingsMode: "local" | "api";
}) {
  const [text, setText] = useState("");
  // Заявки из загруженных файлов — списком до добавления, в поле не попадают: иначе текст был бы
  // виден дважды. «Отменить» убирает их, ничего не отправляя на сервер
  const [loaded, setLoaded] = useState<LoadedFile[]>([]);
  // Список из файла свёрнут за строкой-сводкой, как список документов: иначе шаг снова растёт
  const [loadedOpen, setLoadedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = useMemo(() => splitRequests(text), [text]);
  // Добавляются вместе: сначала заявки из файлов (в порядке списка), потом из поля
  const found = useMemo(() => [...loaded.flatMap((file) => file.items), ...typed], [loaded, typed]);
  const problems = useMemo(() => limitProblems(loaded, typed), [loaded, typed]);

  // Высота поля — по тексту: сначала сброс, потом высота содержимого вместе с рамкой.
  // Верхний предел — max-h-72 в классах поля. Пересчёт — при вводе и при смене ширины поля:
  // строки переносятся иначе (окно уже или шире, шаги встают в один столбец)
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldWidth = useRef(0);
  function fitField() {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }
  useLayoutEffect(fitField, [text]);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // Только ширина: смена высоты — от самого пересчёта, на неё не отвечаем
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === fieldWidth.current) return;
      fieldWidth.current = width;
      fitField();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const texts = await Promise.all(list.map((f) => f.text()));
    // Каждый файл разбивается отдельно: граница файла — всегда граница заявки
    const parsed = list.map((f, i) => ({ name: f.name, items: splitRequests(texts[i]) }));
    const empty = parsed.filter((file) => file.items.length === 0).map((file) => file.name);
    const fresh = parsed.filter((file) => file.items.length > 0);
    // Пустой файл назван в сообщении и в сводку не попадает; остальные файлы загружаются.
    // Пустой файл с названием уже загруженного прежние заявки не заменяет (решение владельца):
    // скорее всего, выбран не тот файл, — и сообщение говорит, что они остались
    const emptyKept = empty.filter((name) => loaded.some((old) => old.name === name));
    const emptyNew = empty.filter((name) => !emptyKept.includes(name));
    const several = (names: string[]) => names.length > 1;
    const emptyMessages = [
      ...(emptyNew.length > 0
        ? [`В ${several(emptyNew) ? "файлах" : "файле"} ${fileList(emptyNew)} нет текста заявок.`]
        : []),
      ...(emptyKept.length > 0
        ? [
            `В ${several(emptyKept) ? "файлах" : "файле"} ${fileList(emptyKept)} нет текста заявок — заявки из ${several(emptyKept) ? "них" : "него"}, загруженные ранее, остались.`,
          ]
        : []),
    ];
    setError(emptyMessages.length > 0 ? emptyMessages.join("\n") : null);
    if (fresh.length === 0) return;
    // Файл с тем же названием заменяет свои прежние заявки, как документ в шаге 1, — после
    // подтверждения: правки в файле могли быть случайными. «Отмена» не загружает ничего из выбранного
    const repeated = fresh.filter((file) => loaded.some((old) => old.name === file.name)).map((file) => file.name);
    if (
      repeated.length > 0 &&
      !window.confirm(
        `Заявки из ${repeated.length > 1 ? "файлов" : "файла"} ${fileList(repeated)}, загруженные ранее, будут заменены новыми. Продолжить?`,
      )
    ) {
      return;
    }
    // Заменённый файл остаётся на своём месте в списке, новые — в конце
    setLoaded((current) => [
      ...current.map((old) => fresh.find((file) => file.name === old.name) ?? old),
      ...fresh.filter((file) => !current.some((old) => old.name === file.name)),
    ]);
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
      setLoaded([]);
      setLoadedOpen(false);
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

      {/* Порядок — как в шаге 1: кнопка загрузки, подсказка, ручной ввод. Кнопка второстепенная:
          главное действие шага — «Добавить в список» */}
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
      <p className={HINT}>
        Заявки разделяются пустой строкой. Если пустых строк нет, каждая строка — отдельная заявка.
      </p>

      {/* Заявки из файлов — до добавления: ошибку разбиения видно сразу, и её можно отменить */}
      {loaded.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <button
              type="button"
              className={`${TOGGLE} min-w-0 break-words text-left`}
              aria-expanded={loadedOpen}
              // Список есть в разметке только раскрытым — ссылка на него тоже
              aria-controls={loadedOpen ? "loaded-requests" : undefined}
              onClick={() => setLoadedOpen((open) => !open)}
            >
              <ChevronRight
                size={16}
                aria-hidden
                className={`shrink-0 motion-safe:transition-transform ${loadedOpen ? "rotate-90" : ""}`}
              />
              {loaded.map((file) => file.name).join(", ")} — найдено {found.length - typed.length}
            </button>
            <button
              type="button"
              className={LINK_BUTTON}
              disabled={busy}
              onClick={() => {
                setLoaded([]);
                setLoadedOpen(false);
              }}
            >
              <X size={14} aria-hidden />
              Отменить
            </button>
          </div>
          {/* У каждого файла своя нумерация — по ней сообщения о длинной заявке называют номер.
              Название над списком — только когда файлов несколько */}
          {loadedOpen && (
            <div id="loaded-requests" className="flex max-h-48 flex-col gap-2 overflow-y-auto text-sm">
              {loaded.map((file) => (
                <div key={file.name} className="flex flex-col gap-1">
                  {loaded.length > 1 && <p className="font-medium break-words">{file.name}</p>}
                  <ol className="flex list-decimal flex-col gap-1 pl-6">
                    {file.items.map((item, i) => (
                      <li key={i}>
                        {/* line-clamp на самом li убрал бы номер пункта — поэтому внутренний span */}
                        <span className="line-clamp-2 whitespace-pre-line break-words">{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Три строки и растёт при вводе до max-h-72, дальше — прокрутка внутри поля.
          Списка под полем нет — текст и так виден в самом поле */}
      <textarea
        ref={fieldRef}
        rows={3}
        className={`${INPUT} max-h-72 resize-none`}
        placeholder="Вставьте заявки из почты, чата или таблицы"
        aria-label="Текст входящих заявок"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {/* Если сработало «каждая строка — заявка», число поясняется: списка под полем нет */}
      {typed.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Введено вручную: {typed.length}</span>
          {splitsByLines(text) && " — пустых строк нет, каждая строка стала отдельной заявкой."}
        </p>
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
