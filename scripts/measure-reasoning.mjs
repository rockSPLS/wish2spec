// Замер LLM_REASONING_EFFORT: прогоняет 12 демо-заявок через ту же обработку, что и продукт,
// с разными уровнями рассуждения и сравнивает вердикты с ожидаемыми.
// Уровень передаётся из скрипта (маршрут замера /api/dev/measure), .env.local не меняется.
//
// Перед запуском: `npm run dev` в другом окне. Скрипт сам загружает демо-документы из demo/
// (документы с теми же названиями заменяются) и ничего не пишет в список заявок.
// Запуск из корня проекта: npm run measure:reasoning
// Другие значения или порт: node scripts/measure-reasoning.mjs --efforts none,low,medium --port 3003

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const EFFORTS = option("efforts", "none,low").split(",");
const BASE = `http://localhost:${option("port", "3003")}`;
const DEMO = path.join(process.cwd(), "demo");
const REQUESTS_FILE = "Входящие заявки.txt";
const EXPECTED_FILE = "Ожидаемые вердикты.json";

async function api(url, body, method = "POST") {
  const response = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

// Демо-документы — все .md и .txt из demo/, кроме файла заявок
const files = (await readdir(DEMO)).filter((f) => /\.(md|txt)$/.test(f) && f !== REQUESTS_FILE);
const documents = await Promise.all(
  files.map(async (f) => {
    const ext = path.extname(f);
    return { name: path.basename(f, ext), format: ext.slice(1), text: await readFile(path.join(DEMO, f), "utf8") };
  }),
);
const { documents: indexed } = await api("/api/documents", { documents });
const extra = indexed.filter((d) => !documents.some((x) => x.name === d.name));
if (extra.length > 0) {
  console.warn(`Внимание: кроме демо в индексе есть другие документы (${extra.map((d) => d.name).join(", ")}) — они влияют на поиск.`);
}

// Разбиение — по пустой строке, как на странице (lib/split-requests.ts)
const requests = (await readFile(path.join(DEMO, REQUESTS_FILE), "utf8"))
  .replace(/\r\n?/g, "\n")
  .trim()
  .split(/\n[ \t]*\n/)
  .map((s) => s.trim());
const expected = JSON.parse(await readFile(path.join(DEMO, EXPECTED_FILE), "utf8")).expected;
if (requests.length !== Object.keys(expected).length) {
  throw new Error(`Заявок ${requests.length}, а ожидаемых вердиктов ${Object.keys(expected).length}`);
}

const matches = (exp, result) =>
  result.verdict === exp.verdict && (exp.verdict !== "similar" || result.taskNumber === exp.taskNumber);
const label = (v) => (v.verdict === "similar" ? `similar №${v.taskNumber}` : v.verdict);
const sum = (usage) => usage.analysis.totalTokens + (usage.spec?.totalTokens ?? 0);

const report = { measuredAt: new Date().toISOString(), runs: [] };
for (const effort of EFFORTS) {
  console.log(`\n=== reasoningEffort: ${effort}`);
  const rows = [];
  for (const [i, text] of requests.entries()) {
    const n = String(i + 1);
    const start = performance.now();
    try {
      const { result } = await api("/api/dev/measure", { text, reasoningEffort: effort });
      const ms = Math.round(performance.now() - start);
      const ok = matches(expected[n], result);
      rows.push({ n, ms, ok, expected: label(expected[n]), got: label(result), usage: result.usage });
      const u = result.usage;
      const spec = u.spec ? ` + основа ТЗ ${u.spec.inputTokens}/${u.spec.outputTokens} (рассужд. ${u.spec.reasoningTokens})` : "";
      console.log(
        `${n.padStart(2)}. ${ok ? "совпало   " : "НЕ совпало"} ожидалось ${label(expected[n]).padEnd(14)} получено ${label(result).padEnd(14)} ${String(ms).padStart(6)} мс  ` +
          `токены вход/выход: разбор ${u.analysis.inputTokens}/${u.analysis.outputTokens} (рассужд. ${u.analysis.reasoningTokens})${spec}`,
      );
    } catch (error) {
      rows.push({ n, ms: Math.round(performance.now() - start), ok: false, expected: label(expected[n]), error: error.message });
      console.log(`${n.padStart(2)}. ОШИБКА ${error.message}`);
    }
  }
  const done = rows.filter((r) => r.usage);
  const totalMs = rows.reduce((s, r) => s + r.ms, 0);
  const tokens = done.reduce((s, r) => s + sum(r.usage), 0);
  const summary = {
    effort,
    matched: rows.filter((r) => r.ok).length,
    total: rows.length,
    avgMs: Math.round(totalMs / rows.length),
    maxMs: Math.max(...rows.map((r) => r.ms)),
    tokens,
    reasoningTokens: done.reduce((s, r) => s + r.usage.analysis.reasoningTokens + (r.usage.spec?.reasoningTokens ?? 0), 0),
  };
  console.log(
    `Итого ${effort}: совпало ${summary.matched} из ${summary.total}, в среднем ${summary.avgMs} мс на заявку (максимум ${summary.maxMs}), ` +
      `токенов всего ${summary.tokens}, из них рассуждения ${summary.reasoningTokens}`,
  );
  report.runs.push({ summary, rows });
}

// Правило выбора: none, если совпадений не меньше, чем с low; иначе low
const none = report.runs.find((r) => r.summary.effort === "none");
const low = report.runs.find((r) => r.summary.effort === "low");
if (none && low) {
  const pick = none.summary.matched >= low.summary.matched ? "none" : "low";
  console.log(`\nРекомендация: LLM_REASONING_EFFORT=${pick}`);
}

await mkdir(path.join(process.cwd(), "data"), { recursive: true });
const out = path.join(process.cwd(), "data", `measure-reasoning-${report.measuredAt.replace(/[:.]/g, "-")}.json`);
await writeFile(out, JSON.stringify(report, null, 2), "utf8");
console.log(`Подробности: ${out}`);
