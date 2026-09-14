export function normalizeFieldWord(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function shuffleFieldItems(items, random = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function uniqueWords(words) {
  const seen = new Set();
  const unique = [];

  for (const word of words ?? []) {
    const normalizedWord = normalizeFieldWord(word);
    if (!normalizedWord || seen.has(normalizedWord)) continue;
    seen.add(normalizedWord);
    unique.push({ word, normalizedWord });
  }

  return unique;
}

export function createFieldSubcategoryBuckets(entries, englishLabels = {}) {
  const groups = new Map();

  for (const entry of entries) {
    if (!entry.bucketId || !entry.sourceLabel || !entry.word) continue;
    const groupKey = [entry.book, entry.chapter, entry.bucketId, entry.sourceLabel].join("::");
    const group = groups.get(groupKey) ?? {
      bucket_id: `field-subcategory::${groupKey}`,
      parentBucketId: entry.bucketId,
      book: entry.book,
      chapter: entry.chapter,
      label: entry.sourceLabel,
      englishLabel: englishLabels[entry.sourceLabel] ?? entry.sourceLabel,
      words: [],
    };
    group.words.push(entry.word);
    groups.set(groupKey, group);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    words: uniqueWords(group.words).map((item) => item.word),
  }));
}

export function prepareFieldBuckets(buckets, entries) {
  const bucketsById = new Map(buckets.map((bucket) => [bucket.bucket_id, bucket]));
  const exactWordsByBucket = new Map();

  for (const entry of entries) {
    const bucket = bucketsById.get(entry.bucketId);
    if (!bucket || entry.sourceLabel !== bucket.label) continue;
    const words = exactWordsByBucket.get(bucket.bucket_id) ?? [];
    words.push(entry.word);
    exactWordsByBucket.set(bucket.bucket_id, words);
  }

  return buckets.map((bucket) => {
    const exactWords = exactWordsByBucket.get(bucket.bucket_id) ?? [];
    return { ...bucket, words: exactWords.length > 0 ? exactWords : bucket.words };
  });
}

export function createFieldRoundOrder(scopedBuckets, random = Math.random) {
  const bucketIds = Array.from(
    new Set(scopedBuckets.map((bucket) => bucket.bucket_id).filter(Boolean)),
  );
  return shuffleFieldItems(bucketIds, random);
}

export function restoreFieldProgress(rawProgress, scopedBuckets, random = Math.random) {
  const expectedIds = scopedBuckets.map((bucket) => bucket.bucket_id).filter(Boolean);
  const expectedIdSet = new Set(expectedIds);
  const savedOrder = Array.isArray(rawProgress?.order) ? rawProgress.order : [];
  const savedOrderSet = new Set(savedOrder);
  const hasCurrentOrder =
    savedOrder.length === expectedIds.length &&
    savedOrderSet.size === expectedIdSet.size &&
    savedOrder.every((bucketId) => expectedIdSet.has(bucketId));

  if (!hasCurrentOrder) {
    return {
      version: 1,
      order: createFieldRoundOrder(scopedBuckets, random),
      index: 0,
      correctCount: 0,
    };
  }

  const index = Number.isInteger(rawProgress.index)
    ? Math.min(Math.max(rawProgress.index, 0), savedOrder.length)
    : 0;
  const correctCount = Number.isInteger(rawProgress.correctCount)
    ? Math.min(Math.max(rawProgress.correctCount, 0), index)
    : 0;

  return { version: 1, order: savedOrder, index, correctCount };
}

export function createFieldQuestion(targetBucket, allBookBuckets, random = Math.random) {
  if (!targetBucket?.bucket_id) throw new Error("출제할 의미 범주가 없습니다.");

  const targetWords = uniqueWords(targetBucket.words);
  if (targetWords.length === 0) {
    throw new Error(`${targetBucket.bucket_id} 범주에 출제할 단어가 없습니다.`);
  }

  const targetWordKeys = new Set(targetWords.map((item) => item.normalizedWord));
  const outsiderCandidates = [];
  const outsiderKeys = new Set();

  for (const bucket of allBookBuckets) {
    if (bucket.bucket_id === targetBucket.bucket_id) continue;
    for (const item of uniqueWords(bucket.words)) {
      if (targetWordKeys.has(item.normalizedWord) || outsiderKeys.has(item.normalizedWord)) {
        continue;
      }
      outsiderKeys.add(item.normalizedWord);
      outsiderCandidates.push({
        ...item,
        sourceBucketId: bucket.bucket_id,
        sourceBucketLabel: bucket.label,
        sourceBucketEnglishLabel: bucket.englishLabel ?? bucket.english_label ?? bucket.label,
      });
    }
  }

  if (outsiderCandidates.length === 0) {
    throw new Error(`${targetBucket.bucket_id} 범주의 오답 단어를 만들 수 없습니다.`);
  }

  const selectedTargetWords = shuffleFieldItems(targetWords, random).slice(
    0,
    Math.min(4, targetWords.length),
  );
  const outsider = shuffleFieldItems(outsiderCandidates, random)[0];
  const options = shuffleFieldItems(
    [
      ...selectedTargetWords.map((item) => ({
        ...item,
        isOutsider: false,
        sourceBucketId: targetBucket.bucket_id,
        sourceBucketLabel: targetBucket.label,
        sourceBucketEnglishLabel:
          targetBucket.englishLabel ?? targetBucket.english_label ?? targetBucket.label,
      })),
      { ...outsider, isOutsider: true },
    ],
    random,
  );

  return {
    bucketId: targetBucket.bucket_id,
    chapter: targetBucket.chapter,
    label: targetBucket.label,
    englishLabel: targetBucket.englishLabel ?? targetBucket.english_label ?? targetBucket.label,
    options,
  };
}
