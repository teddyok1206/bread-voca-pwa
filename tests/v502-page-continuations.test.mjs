import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pack = JSON.parse(await readFile(new URL("../vocab_pack.json", import.meta.url), "utf8"));
const buckets = new Map(
  pack.semantic_buckets
    .filter((bucket) => bucket.book === "V502")
    .map((bucket) => [bucket.bucket_id, bucket]),
);
const entries = pack.entries.filter((entry) => entry.book === "V502");
const continuations = [];
// V502 ver. 11.1: these Korean labels are printed at the end of page n,
// while some of their English words continue at the start of page n+1.
const previousPageLabels = new Map([
  ["v502_023::꾸물거리며 걷다", 16], // 7 -> 8
  ["v502_027::용기, 기개", 10], // 8 -> 9
  ["v502_037::경계, 가장자리", 4], // 9 -> 10
  ["v502_312::복잡하게 엉킨 실타래, 혼란, 분규", 2], // 37 -> 38
]);
const continuationCounts = new Map();

for (const entry of entries) {
  const bucket = buckets.get(entry.bucket_id);
  assert.ok(bucket, `${entry.id}: 범주 없음`);
  assert.ok(
    entry.source_page === bucket.source_page || entry.source_page === bucket.source_page + 1,
    `${entry.id}: 예상하지 못한 원본 페이지`,
  );
  const key = `${entry.bucket_id}::${entry.source_label}`;
  const crossesPage = entry.source_page === bucket.source_page + 1 && previousPageLabels.has(key);
  assert.equal(
    entry.chapter,
    crossesPage ? bucket.chapter : entry.source_page,
    `${entry.id}: 학습 페이지는 해당 한국어 뜻이 인쇄된 페이지`,
  );
  if (crossesPage) {
    continuations.push(entry);
    continuationCounts.set(key, (continuationCounts.get(key) ?? 0) + 1);
  }
}

assert.equal(continuations.length, 32, "두 페이지에 걸친 V502 단어 수");
assert.deepEqual(continuationCounts, previousPageLabels);
const diddle = entries.find((entry) => entry.id === "v502_0273_diddle");
assert.equal(diddle.chapter, 7);
assert.equal(diddle.source_page, 8);
assert.equal(diddle.bucket_id, "v502_023");
assert.equal(entries.find((entry) => entry.id === "v502_0289_precipitate")?.chapter, 8);

for (const { book, chapter, count } of pack.stats.chapter_counts.filter((item) => item.book === "V502")) {
  assert.equal(entries.filter((entry) => entry.chapter === chapter).length, count, `${book} ${chapter} 통계`);
}

console.log("V502: 4개 한국어 소분류의 페이지 넘김 단어 32개가 앞 페이지에 포함됨");
