"use client";

import { useEffect, useState } from "react";
import type { DocumentSummary, IncomingRequest } from "@/lib/types";
import { callApi } from "./api";
import { DocumentsStep } from "./documents-step";
import type { CardActions, RunState } from "./request-card";
import { RequestsStep } from "./requests-step";
import { ResultsStep } from "./results-step";
import { ERROR, HINT } from "./ui";

// Три шага на одной странице. Данные хранятся на сервере (data/), страница их только показывает.

export function Workspace() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [embeddingsMode, setEmbeddingsMode] = useState<"local" | "api">("local");
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Пока идёт обработка (пачки, одной заявки или основы ТЗ), другие действия, которые меняют
  // заявки, недоступны: сервер всё равно ответил бы «заявка обрабатывается»
  const busy = running || Object.keys(runStates).length > 0;

  useEffect(() => {
    Promise.all([
      callApi<{ documents: DocumentSummary[]; embeddingsMode: "local" | "api" }>("/api/documents"),
      callApi<{ requests: IncomingRequest[] }>("/api/requests"),
    ])
      .then(([d, r]) => {
        setDocuments(d.documents);
        setEmbeddingsMode(d.embeddingsMode);
        setRequests(r.requests);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  function replaceRequest(updated: IncomingRequest) {
    setRequests((list) => list.map((r) => (r.id === updated.id ? updated : r)));
  }

  function setRunState(id: string, state: RunState | null) {
    setRunStates((s) => {
      const next = { ...s };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }

  // Обработка одной заявки. again — «Обработать заново», text — исправленный текст заявки.
  // Возвращает текст ошибки, если сервер обработку не начал (не ответил или отказал), иначе null
  async function processRequest(id: string, options: { again?: boolean; text?: string } = {}): Promise<string | null> {
    setRunState(id, "processing");
    const before = requests.find((r) => r.id === id);
    if (options.again && before) {
      // Пока модель отвечает, карточка показывает новый текст без старого результата — как на сервере.
      // Прежний вариант придёт с ответом сервера
      replaceRequest({ ...before, text: options.text ?? before.text, status: "pending", result: null, error: null, edits: undefined });
    }
    try {
      const data = await callApi<{ request: IncomingRequest }>("/api/requests/process", {
        method: "POST",
        body: { id, ...options },
      });
      replaceRequest(data.request);
      // Первая готовая заявка открывается в карточке, если ничего не выбрано
      setSelectedId((current) => current ?? id);
      return null;
    } catch (e) {
      const message = (e as Error).message;
      const data = (e as { data?: { request?: IncomingRequest } }).data;
      if (data?.request) {
        // Ошибка обработки сохранена на сервере — она в строке и в карточке, у «Повторить»
        replaceRequest(data.request);
        return null;
      }
      // Сервер обработку не начал — на сервере заявка прежняя. У «Обработать заново» возвращаем её
      // как была, а ошибку показывает карточка у кнопки. При обработке списка — ошибка в строке,
      // не сохраняя её
      if (before) replaceRequest(options.again ? before : { ...before, status: "error", error: message });
      return options.again ? message : null;
    } finally {
      setRunState(id, null);
    }
  }

  // Заявки отправляются на сервер по одной, по очереди; готовые сразу появляются в списке.
  // Ошибка одной заявки не останавливает остальные
  async function processAll() {
    const ids = requests.filter((r) => r.status !== "done").map((r) => r.id);
    if (ids.length === 0) return;
    setRunning(true);
    setRunStates(Object.fromEntries(ids.map((id) => [id, "queued" as const])));
    for (const id of ids) await processRequest(id);
    setRunning(false);
  }

  // Действия карточки. Ошибка возвращается текстом — карточка показывает её рядом с кнопкой
  const actions: CardActions = {
    process: (id, options) => processRequest(id, options),
    async edit(body) {
      try {
        const data = await callApi<{ request: IncomingRequest }>("/api/requests", { method: "PATCH", body });
        replaceRequest(data.request);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    },
    async prepareSpec(id) {
      setRunState(id, "spec");
      try {
        const data = await callApi<{ request: IncomingRequest }>("/api/requests/spec", {
          method: "POST",
          body: { id },
        });
        replaceRequest(data.request);
        return null;
      } catch (e) {
        return (e as Error).message;
      } finally {
        setRunState(id, null);
      }
    },
    async remove(request) {
      if (!window.confirm(`Удалить заявку №${request.number}? Результат и правки удалятся вместе с ней.`)) return null;
      try {
        const data = await callApi<{ requests: IncomingRequest[] }>("/api/requests", {
          method: "DELETE",
          body: { id: request.id },
        });
        setRequests(data.requests);
        setSelectedId(null);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    },
  };

  async function clearList(): Promise<string | null> {
    const count = requests.length;
    if (!window.confirm(`Удалить все заявки из списка (${count})? Результаты и правки удалятся вместе с ними.`)) {
      return null;
    }
    try {
      const data = await callApi<{ requests: IncomingRequest[] }>("/api/requests", {
        method: "DELETE",
        body: { all: true },
      });
      setRequests(data.requests);
      setSelectedId(null);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  if (loadError) {
    return (
      <p className={ERROR} role="alert">
        Не удалось загрузить данные: {loadError}
      </p>
    );
  }
  if (documents === null) {
    return <p className={HINT}>Загружаю…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <DocumentsStep documents={documents} onChange={setDocuments} />
        <RequestsStep onAdded={setRequests} embeddingsMode={embeddingsMode} />
      </div>
      <ResultsStep
        requests={requests}
        runStates={runStates}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onProcess={() => void processAll()}
        onClear={clearList}
        running={running}
        busy={busy}
        hasDocuments={documents.length > 0}
        actions={actions}
      />
    </div>
  );
}
