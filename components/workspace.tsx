"use client";

import { useEffect, useState } from "react";
import type { DocumentSummary, IncomingRequest } from "@/lib/types";
import { callApi } from "./api";
import { DocumentsStep } from "./documents-step";
import type { RunState } from "./request-card";
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

  // Заявки отправляются на сервер по одной, по очереди; готовые сразу появляются в списке.
  // Ошибка одной заявки не останавливает остальные
  async function processAll() {
    const ids = requests.filter((r) => r.status !== "done").map((r) => r.id);
    if (ids.length === 0) return;
    setRunning(true);
    setRunStates(Object.fromEntries(ids.map((id) => [id, "queued" as const])));
    for (const id of ids) {
      setRunStates((s) => ({ ...s, [id]: "processing" }));
      try {
        const data = await callApi<{ request: IncomingRequest }>("/api/requests/process", {
          method: "POST",
          body: { id },
        });
        replaceRequest(data.request);
        // Первая готовая заявка открывается в карточке, если ничего не выбрано
        setSelectedId((current) => current ?? id);
      } catch (e) {
        const data = (e as { data?: { request?: IncomingRequest } }).data;
        if (data?.request) replaceRequest(data.request);
        else {
          // Сервер не ответил — показываем ошибку в строке, не сохраняя её
          setRequests((list) =>
            list.map((r) => (r.id === id ? { ...r, status: "error", error: (e as Error).message } : r)),
          );
        }
      }
      setRunStates((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
    setRunning(false);
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
        running={running}
        hasDocuments={documents.length > 0}
      />
    </div>
  );
}
