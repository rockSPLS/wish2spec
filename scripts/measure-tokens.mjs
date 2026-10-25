// Замер: сколько символов русского текста приходится на один токен модели эмбеддингов
// и сколько токенов в самом длинном фрагменте. Модель обрезает текст до 512 токенов —
// фрагмент длиннее потерял бы конец.
// Берёт фрагменты из индекса data/index.json — сначала загрузите документы на странице.
// Запуск из корня проекта: npm run measure:tokens

import { readFile } from "node:fs/promises";
import path from "node:path";
import { AutoTokenizer, env } from "@huggingface/transformers";

const MODEL_ID = "Xenova/multilingual-e5-small";
const MODEL_MAX_TOKENS = 512;
env.cacheDir = path.join(process.cwd(), "data", "models");

const index = JSON.parse(await readFile(path.join(process.cwd(), "data", "index.json"), "utf8"));
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);

// Тот же текст, что уходит в модель эмбеддингов: префикс, путь заголовков и текст фрагмента
// (как chunkContent в lib/chunking.ts и embedTexts в lib/embeddings.ts)
const rows = index.documents.flatMap((doc) =>
  doc.chunks.map((chunk) => {
    const text = `passage: ${chunk.path.join(" › ")}\n${chunk.text}`;
    // Без служебных токенов начала и конца — только сам текст
    const tokens = tokenizer.encode(text, { add_special_tokens: false }).length;
    return { doc: doc.name, path: chunk.path.join(" › "), chars: text.length, tokens };
  }),
);

const totalChars = rows.reduce((s, r) => s + r.chars, 0);
const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
const perToken = rows.map((r) => r.chars / r.tokens).sort((a, b) => a - b);
const longest = rows.reduce((a, b) => (b.tokens > a.tokens ? b : a));

console.log(`Документов: ${index.documents.length}, фрагментов: ${rows.length}`);
for (const doc of index.documents) {
  const own = rows.filter((r) => r.doc === doc.name);
  const c = own.reduce((s, r) => s + r.chars, 0);
  const t = own.reduce((s, r) => s + r.tokens, 0);
  console.log(`  ${doc.name}: ${own.length} фрагм., ${(c / t).toFixed(2)} символа на токен`);
}
console.log(`Всего: ${totalChars} символов, ${totalTokens} токенов — ${(totalChars / totalTokens).toFixed(2)} символа на токен`);
console.log(`По фрагментам: от ${perToken[0].toFixed(2)} до ${perToken[perToken.length - 1].toFixed(2)} символа на токен`);
console.log(`Самый длинный фрагмент: ${longest.tokens} токенов, ${longest.chars} символов — ${longest.path}`);
console.log(`512 токенов ≈ ${Math.round((MODEL_MAX_TOKENS * totalChars) / totalTokens)} символов при среднем значении`);
const over = rows.filter((r) => r.tokens + 2 > MODEL_MAX_TOKENS);
console.log(over.length === 0 ? "Все фрагменты помещаются в 512 токенов" : `Длиннее 512 токенов: ${over.length}`);
