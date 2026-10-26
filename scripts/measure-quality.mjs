// Замер качества обработки на контрольном наборе (control-set/) или на демо-заявках (demo/).
// Прогоняет заявки через ту же обработку, что и продукт (маршрут замера /api/dev/measure),
// и сравнивает с ожидаемыми результатами:
//   1) совпадение вердиктов, в том числе номера задачи;
//   2) попали ли ожидаемые связи в выдачу поиска — до порога «связей не найдено» и после;
//   3) отметка «Проверьте»: какая доля ошибочных вердиктов под ней и какая доля верных получила её зря.
// Токены — по каждому вызову модели. Служебные имена вердиктов в текстах модели — отдельной строкой.
//
// Перед запуском: `npm run dev` в другом окне. Скрипт сам загружает демо-документы из demo/
// (документы общие для демо и контрольного набора; с теми же названиями заменяются)
// и ничего не пишет в список заявок.
// Запуск из корня проекта: npm run measure:quality
// Параметры: --set control|demo (по умолчанию control), --effort none, --port 3003,
// --pause 2000 (пауза между заявками, мс), --only 5,23 (только эти заявки)

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const SET = option("set", "control");
const EFFORT = option("effort", "none");
const BASE = `http://localhost:${option("port", "3003")}`;
const PAUSE_MS = Number(option("pause", "2000"));
const ONLY = option("only", "")
  .split(",")
  .filter(Boolean)
  .map((s) => s.trim());

const SETS = {
  control: { dir: "control-set", requests: "Входящие заявки.txt", expected: "Ожидаемые результаты.json" },
  demo: { dir: "demo", requests: "Входящие заявки.txt", expected: "Ожидаемые вердикты.json" },
};
if (!SETS[SET]) throw new Error(`Неизвестный набор «${SET}»: control или demo`);
const DEMO = path.join(process.cwd(), "demo");
const setDir = path.join(process.cwd(), SETS[SET].dir);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, body) {
  const response = await fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

// Ответ 429 (превышен лимит запросов сервиса): AI SDK уже повторил запрос сам — ждём минуту и пробуем ещё
async function measure(text) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api("/api/dev/measure", { text, reasoningEffort: EFFORT });
    } catch (error) {
      if (attempt >= 3 || !/429|rate limit|too many/i.test(error.message)) throw error;
      console.log(`    ответ 429, повтор через 60 с`);
      await sleep(60_000);
    }
  }
}

// Демо-документы — все .md и .txt из demo/, кроме файла заявок
const files = (await readdir(DEMO)).filter((f) => /\.(md|txt)$/.test(f) && f !== SETS.demo.requests);
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
const requests = (await readFile(path.join(setDir, SETS[SET].requests), "utf8"))
  .replace(/\r\n?/g, "\n")
  .trim()
  .split(/\n[ \t]*\n/)
  .map((s) => s.trim());
const expected = JSON.parse(await readFile(path.join(setDir, SETS[SET].expected), "utf8")).expected;
if (requests.length !== Object.keys(expected).length) {
  throw new Error(`Заявок ${requests.length}, а ожидаемых результатов ${Object.keys(expected).length}`);
}

const label = (v) => (v.verdict === "similar" ? `similar №${v.taskNumber}` : v.verdict);
const matches = (exp, result) =>
  result.verdict === exp.verdict && (exp.verdict !== "similar" || result.taskNumber === exp.taskNumber);
// Связь найдена, если среди фрагментов есть фрагмент этого документа, в пути заголовков которого есть section
const linkFound = (link, fragments) =>
  fragments.some((f) => f.path[0] === link.document && f.path.slice(1).join(" › ").includes(link.section));
const linkName = (link) => (link.section ? `${link.document} › ${link.section}` : link.document);

// Служебное имя вердикта отдельным словом в тексте для аналитика — замена на ярлык не сработала
const VERDICT_ID = /(?<![\p{L}\p{N}_])(exists|similar|new|clarify|out_of_scope)(?![\p{L}\p{N}_])/gu;
function verdictIdsInTexts(result) {
  const texts = [
    result.analysis.who,
    result.analysis.what,
    result.analysis.where,
    result.reasoning,
    ...result.questions,
    ...(result.spec
      ? [result.spec.title, result.spec.problem, ...result.spec.scenario, ...result.spec.acceptance, ...result.spec.questions]
      : []),
  ];
  return texts.flatMap((t) => [...t.matchAll(VERDICT_ID)].map((m) => t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)));
}

const usageText = (u) => `${u.inputTokens}/${u.outputTokens}${u.reasoningTokens ? ` (рассужд. ${u.reasoningTokens})` : ""}`;
const pct = (a, b) => (b === 0 ? "—" : `${a} из ${b} (${Math.round((100 * a) / b)} %)`);

console.log(`Набор: ${SETS[SET].dir}, reasoningEffort: ${EFFORT}, заявок: ${ONLY.length || requests.length}`);
const rows = [];
for (const [i, text] of requests.entries()) {
  const n = String(i + 1);
  if (ONLY.length > 0 && !ONLY.includes(n)) continue;
  const exp = expected[n];
  if (rows.length > 0 && PAUSE_MS > 0) await sleep(PAUSE_MS);
  const start = performance.now();
  try {
    const { result } = await measure(text);
    const ms = Math.round(performance.now() - start);
    // До порога — все кандидаты из шестёрки ближайших; после — только переданные модели.
    // У результатов v0.1 поля discarded нет: порога ещё не было, «до» и «после» совпадают
    const after = result.retrieved;
    const before = [...after, ...(result.discarded ?? [])];
    const links = exp.links ?? [];
    const row = {
      n,
      chars: text.length,
      kinds: exp.kinds ?? [],
      ok: matches(exp, result),
      expected: label(exp),
      got: label(result),
      review: result.review ?? null,
      links: links.map((l) => ({ link: linkName(l), before: linkFound(l, before), after: linkFound(l, after) })),
      kept: after.length,
      topScore: before.length > 0 ? Math.max(...before.map((f) => f.score)) : null,
      verdictIds: verdictIdsInTexts(result),
      ms,
      usage: result.usage,
      result,
    };
    rows.push(row);
    const linkMarks = row.links.map((l) => `${l.before ? "+" : "-"}${l.after ? "+" : "-"}`).join(" ");
    const flag = row.review === null ? "" : row.review.length > 0 ? ` «Проверьте»: ${row.review.map((r) => r.kind).join(", ")}` : "";
    const spec = result.usage.spec ? `, основа ТЗ ${usageText(result.usage.spec)}` : "";
    console.log(
      `${n.padStart(2)}. ${row.ok ? "совпало   " : "НЕ совпало"} ожидалось ${row.expected.padEnd(14)} получено ${row.got.padEnd(14)}` +
        ` связи до/после порога: ${linkMarks || "нет"}; передано ${row.kept}${flag}` +
        `  ${ms} мс, токены вход/выход: разбор ${usageText(result.usage.analysis)}${spec}`,
    );
    for (const id of row.verdictIds) console.log(`    служебное имя в тексте: …${id}…`);
  } catch (error) {
    rows.push({ n, ok: false, expected: label(exp), error: error.message, ms: Math.round(performance.now() - start) });
    console.log(`${n.padStart(2)}. ОШИБКА ${error.message}`);
  }
}

// --- Итоги ---
const done = rows.filter((r) => r.result);
const links = done.flatMap((r) => r.links);
const withLinks = done.filter((r) => r.links.length > 0);
const noLinks = done.filter((r) => r.links.length === 0);
const hasReview = done.some((r) => r.review !== null);
const flagged = (r) => r.review !== null && r.review.length > 0;
const wrong = done.filter((r) => !r.ok);
const right = done.filter((r) => r.ok);
const total = (u) => u.analysis.totalTokens + (u.spec?.totalTokens ?? 0);

const summary = {
  set: SETS[SET].dir,
  effort: EFFORT,
  requests: rows.length,
  errors: rows.length - done.length,
  matched: rows.filter((r) => r.ok).length,
  linksBefore: links.filter((l) => l.before).length,
  linksAfter: links.filter((l) => l.after).length,
  linksTotal: links.length,
  requestsAllLinksBefore: withLinks.filter((r) => r.links.every((l) => l.before)).length,
  requestsAllLinksAfter: withLinks.filter((r) => r.links.every((l) => l.after)).length,
  requestsWithLinks: withLinks.length,
  noLinksEmptyAfter: noLinks.filter((r) => r.kept === 0).length,
  noLinksTotal: noLinks.length,
  wrongFlagged: hasReview ? wrong.filter(flagged).length : null,
  wrongTotal: wrong.length,
  rightFlagged: hasReview ? right.filter(flagged).length : null,
  rightTotal: right.length,
  verdictIdHits: done.reduce((s, r) => s + r.verdictIds.length, 0),
  tokens: done.reduce((s, r) => s + total(r.usage), 0),
  calls: done.reduce((s, r) => s + 1 + (r.usage.spec ? 1 : 0), 0),
};

console.log(`\nИтого (${summary.set}, ${EFFORT}):`);
console.log(`  1) вердикт совпал: ${pct(summary.matched, summary.requests)}${summary.errors ? `, ошибок ${summary.errors}` : ""}`);
console.log(
  `  2) ожидаемые связи в выдаче: до порога ${pct(summary.linksBefore, summary.linksTotal)}, после — ${pct(summary.linksAfter, summary.linksTotal)}; ` +
    `заявок со всеми связями: до ${pct(summary.requestsAllLinksBefore, summary.requestsWithLinks)}, после — ${pct(summary.requestsAllLinksAfter, summary.requestsWithLinks)}; ` +
    `заявок без связей, у которых после порога ничего не осталось: ${pct(summary.noLinksEmptyAfter, summary.noLinksTotal)}`,
);
console.log(
  hasReview
    ? `  3) «Проверьте»: у ошибочных вердиктов ${pct(summary.wrongFlagged, summary.wrongTotal)}, у верных (зря) ${pct(summary.rightFlagged, summary.rightTotal)}`
    : "  3) отметки «Проверьте» в результатах нет (код до v0.2)",
);
console.log(`  служебных имён вердиктов в текстах: ${summary.verdictIdHits}`);
console.log(`  токенов всего: ${summary.tokens} за ${summary.calls} вызовов модели`);

await mkdir(path.join(process.cwd(), "data"), { recursive: true });
const measuredAt = new Date().toISOString();
const out = path.join(process.cwd(), "data", `measure-quality-${SET}-${measuredAt.replace(/[:.]/g, "-")}.json`);
await writeFile(out, JSON.stringify({ measuredAt, summary, rows }, null, 2), "utf8");
console.log(`Подробности: ${out}`);
