import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createFieldQuestion,
  createFieldRoundOrder,
  createFieldSubcategoryBuckets,
  normalizeFieldWord,
  prepareFieldBuckets,
  restoreFieldProgress,
} from "../assets/field-mode-core.js";
import { v301FieldLabels } from "../assets/v301-field-labels.js";

const pack = JSON.parse(
  await readFile(new URL("../vocab_pack.json", import.meta.url), "utf8"),
);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

for (const [book, expectedCount] of [
  ["V301", 400],
  ["V502", 620],
]) {
  const rawBuckets = pack.semantic_buckets.filter((bucket) => bucket.book === book);
  const entries = pack.entries
    .filter((entry) => entry.book === book)
    .map((entry) => ({
      ...entry,
      bucketId: entry.bucket_id,
      sourceLabel: entry.source_label,
    }));
  const buckets =
    book === "V301"
      ? createFieldSubcategoryBuckets(entries, v301FieldLabels)
      : prepareFieldBuckets(rawBuckets, entries);
  assert.equal(buckets.length, expectedCount, `${book} 범주 수`);
  assert.ok(
    buckets.every((bucket) => (bucket.englishLabel ?? bucket.english_label)?.trim()),
    `${book} 영문 범주 뜻`,
  );
  if (book === "V301") {
    const pursuitSubcategories = buckets.filter(
      (bucket) => bucket.parentBucketId === "v301_02",
    );
    assert.deepEqual(
      new Set(pursuitSubcategories.map((bucket) => bucket.label)),
      new Set([
        "추구하다",
        "유혹하다, 구애하다",
        "당당히 맞서다",
        "회피하다",
        "방향을 바꾸어 피하다",
        "꾀병을 부려 피하다",
      ]),
      "V301 02. 추구/회피의 하위 범주",
    );
    assert.equal(
      pursuitSubcategories.find((bucket) => bucket.label === "추구하다")?.englishLabel,
      "Pursue",
    );
    assert.ok(
      buckets.every((bucket) => !/[가-힣]/.test(bucket.englishLabel)),
      "V301 하위 범주 영문 번역",
    );
  }

  const order = createFieldRoundOrder(buckets, seededRandom(expectedCount));
  assert.equal(order.length, expectedCount);
  assert.equal(new Set(order).size, expectedCount);
  assert.deepEqual(new Set(order), new Set(buckets.map((bucket) => bucket.bucket_id)));

  const restored = restoreFieldProgress(
    { version: 1, order, index: 7, correctCount: 5 },
    buckets,
    seededRandom(1),
  );
  assert.deepEqual(restored, { version: 1, order, index: 7, correctCount: 5 });

  for (const [index, bucketId] of order.entries()) {
    const target = buckets.find((bucket) => bucket.bucket_id === bucketId);
    const question = createFieldQuestion(target, buckets, seededRandom(index + 1));
    const targetKeys = new Set(target.words.map(normalizeFieldWord));
    const outsiderOptions = question.options.filter((option) => option.isOutsider);
    const expectedOptionCount = Math.min(4, targetKeys.size) + 1;

    assert.equal(question.options.length, expectedOptionCount, `${bucketId} 선택지 수`);
    assert.equal(outsiderOptions.length, 1, `${bucketId} 타 범주 단어 수`);
    assert.ok(!targetKeys.has(outsiderOptions[0].normalizedWord), `${bucketId} 타 범주 단어 검증`);
    assert.ok(
      question.options
        .filter((option) => !option.isOutsider)
        .every((option) => targetKeys.has(option.normalizedWord)),
      `${bucketId} 내부 단어 검증`,
    );
  }
}

console.log("field mode: V301 하위 범주 400개 및 V502 범주 620개 검증 완료");
