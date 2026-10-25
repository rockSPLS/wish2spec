// Типы данных, общие для сервера и страницы

export const VERDICTS = ["exists", "similar", "new", "clarify", "out_of_scope"] as const;
export type Verdict = (typeof VERDICTS)[number];

// Документ в списке «Документация системы»
export type DocumentSummary = {
  name: string;
  chunkCount: number;
  addedAt: string;
};

// Источник в карточке — копия фрагмента на момент обработки: если документ потом
// удалят или заменят, карточка всё равно покажет, на что опирался вывод
export type Source = {
  n: number; // номер, под которым фрагмент передавался модели: [1], [2]…
  documentName: string;
  path: string[]; // путь заголовков внутри документа
  text: string;
};

export type SpecModule = { name: string; sourceIds: number[] };

// Основа ТЗ; исходная заявка в неё не входит — её вставляет код, а не модель
export type Spec = {
  title: string;
  problem: string;
  scenario: string[];
  acceptance: string[];
  modules: SpecModule[]; // пусто — «связей не найдено»
  questions: string[];
};

export type CallUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type RequestResult = {
  verdict: Verdict;
  taskNumber: number | null; // только для «похоже на задачу»
  analysis: { who: string; what: string; where: string };
  reasoning: string;
  questions: string[]; // для «требуется уточнение»
  sources: Source[];
  // Все фрагменты, переданные модели, с близостью к заявке — для разбора расхождений
  // и подбора порога «связей не найдено» (версия 0.2). В карточке не показываются
  retrieved: { n: number; path: string[]; score: number }[];
  spec: Spec | null; // для «новое»
  processedAt: string;
  model: string;
  reasoningEffort: string | null;
  ms: number;
  usage: { analysis: CallUsage; spec: CallUsage | null };
};

// Входящая заявка в списке «Результат обработки»
export type IncomingRequest = {
  id: string;
  number: number;
  text: string;
  addedAt: string;
  status: "pending" | "done" | "error"; // pending — ещё не обрабатывалась
  result: RequestResult | null;
  error: string | null;
};
