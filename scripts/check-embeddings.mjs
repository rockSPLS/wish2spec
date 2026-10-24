// Проверка локальных эмбеддингов (итерация 0): работает ли transformers.js на Node 20
// и различает ли модель смысл русских фраз.
// Запуск из корня проекта: node scripts/check-embeddings.mjs
// Первый запуск скачивает модель (~135 МБ) в data/models/, следующие берут её оттуда.

import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

// Многоязычная модель с русским; веса ONNX — конверсия intfloat/multilingual-e5-small (лицензия MIT)
const MODEL_ID = "Xenova/multilingual-e5-small";

// Кэш модели — в data/ проекта (папка в .gitignore), а не внутри node_modules:
// там она пропала бы при переустановке пакетов
env.cacheDir = path.join(process.cwd(), "data", "models");

// Модели семейства e5 обучены с префиксами: «query: » — запрос или фраза для сравнения
// между собой, «passage: » — фрагмент документа. Здесь сравниваем фразы друг с другом,
// поэтому у всех префикс «query: ».
const PHRASES = [
  "напоминание о неоплаченном счёте",
  "уведомление о задолженности",
  "смена пароля",
];

// Векторы нормализованы (normalize: true), поэтому косинусная близость — просто скалярное произведение
function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

const loadStart = performance.now();
// q8 — квантованные веса (~118 МБ вместо ~470 МБ у fp32), на CPU работают быстрее
const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
const loadMs = performance.now() - loadStart;

// Один эмбеддинг отдельно — чтобы замерить время на одну фразу
const oneStart = performance.now();
await extractor("query: " + PHRASES[0], { pooling: "mean", normalize: true });
const oneMs = performance.now() - oneStart;

const output = await extractor(
  PHRASES.map((p) => "query: " + p),
  { pooling: "mean", normalize: true },
);
const vectors = output.tolist();

const sim12 = cosine(vectors[0], vectors[1]);
const sim13 = cosine(vectors[0], vectors[2]);
const sim23 = cosine(vectors[1], vectors[2]);

console.log("Node:", process.version);
console.log("Модель:", MODEL_ID, "(q8), размер вектора:", vectors[0].length);
console.log("Кэш модели:", env.cacheDir);
console.log("Загрузка модели, мс:", Math.round(loadMs));
console.log("Один эмбеддинг, мс:", Math.round(oneMs));
console.log(`«${PHRASES[0]}» ↔ «${PHRASES[1]}»: ${sim12.toFixed(3)}`);
console.log(`«${PHRASES[0]}» ↔ «${PHRASES[2]}»: ${sim13.toFixed(3)}`);
console.log(`«${PHRASES[1]}» ↔ «${PHRASES[2]}»: ${sim23.toFixed(3)}`);

const ok = sim12 > sim13 && sim12 > sim23;
console.log(ok ? "ИТОГ: близкие по смыслу фразы ближе — проверка пройдена" : "ИТОГ: проверка НЕ пройдена");
process.exitCode = ok ? 0 : 1;
