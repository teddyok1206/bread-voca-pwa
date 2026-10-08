import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { v501RedTerms } from "../assets/v501-red-terms.js";
import { filterStudyEntries, isStudyEligible } from "../assets/study-eligibility.js";

const pack = JSON.parse(await readFile(new URL("../vocab_pack.json", import.meta.url), "utf8"));
const marked = JSON.parse(await readFile(new URL("./fixtures/v501-marked-entries.json", import.meta.url), "utf8"));
const entries = pack.entries;
const originalV501 = entries.filter((entry) => entry.book === "V501");
const excludedIds = new Set(v501RedTerms.entries.map((entry) => entry.id).filter(Boolean));
assert.equal(v501RedTerms.source_sha256, marked.source_sha256);
assert.equal(v501RedTerms.entries.length, 376);
assert.equal(excludedIds.size, 360);
assert.equal(v501RedTerms.entries.filter((entry) => entry.id === null).length, 16);
assert.equal(originalV501.length, 2979, "Keep source entries and stable history IDs");
assert.equal(originalV501.filter(isStudyEligible).length, 2619);
assert.deepEqual(originalV501.filter((entry) => !isStudyEligible(entry)).map((entry) => entry.id).sort(), [...excludedIds].sort());

for (const term of v501RedTerms.entries) {
  const found = entries.find((entry) => entry.id === term.id);
  if (term.id) {
    assert.ok(found);
    assert.equal(found.word, term.word);
    assert.equal(found.chapter, term.chapter);
    assert.equal(isStudyEligible(found), false);
  }
  assert.equal(isStudyEligible({ book: "V501", chapter: term.chapter, word: term.word, id: "old-import-id" }), false, "Legacy/imported IDs must not bypass exclusions");
  assert.equal(isStudyEligible({ book: "V501", chapter: String(term.chapter), word: `  ${term.word.toUpperCase()}  ` }), false);
  assert.equal(isStudyEligible({ book: "V502", chapter: term.chapter, word: term.word, id: term.id }), true, "Never exclude another book by spelling/ID");
}
for (const note of marked.entries) assert.equal(isStudyEligible(entries.find((entry) => entry.id === note.id)), true, `Preserve marked word: ${note.word}`);
assert.deepEqual(filterStudyEntries(entries).filter((entry) => entry.book !== "V501"), entries.filter((entry) => entry.book !== "V501"));
for (const word of ["all-time", "taxiing", "embargo", "file for Chapter 11", "literacy rate"]) {
  const found = originalV501.filter((entry) => entry.word === word);
  assert.ok(found.length);
  assert.ok(found.every(isStudyEligible), `Errata red ink is not a study-word exclusion: ${word}`);
}
assert.ok(isStudyEligible({ book: "V501", chapter: 1, word: "market share", id: "black-word-on-another-page" }));

// Execute the actual deployed query adapters against a pre-existing database.
// No deleting/reimporting or review-history migration is needed for exclusion.
const bundle = await readFile(new URL("../assets/index-e81d31da.js", import.meta.url), "utf8");
function source(start, end) {
  const a = bundle.indexOf(start), b = bundle.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Locate shipped adapter: ${start}`);
  return bundle.slice(a, b);
}
const adapters = [
  source("function fs()", "function Ro("),
  source("function Ro(", "function Ed("),
  source("async function vi(", "async function Xp("),
  source("async function Ad(", "function eh("),
  source("async function Ld(", "async function hs("),
  source("async function ph(", "async function hh("),
].join("\n");
const dbEntries = entries.map((entry) => ({ ...entry, sourcePage: entry.source_page }));
const storedById = new Map(dbEntries.map((entry) => [entry.id, entry]));
const before = JSON.stringify(dbEntries);
const scope = (book, chapter, wantedBook, wantedChapter) =>
  (wantedBook === "all" || book === wantedBook) && (wantedChapter === "all" || chapter === wantedChapter);
const context = vm.createContext({
  de: { vocab: {
    toArray: async () => dbEntries.slice(),
    where: (field) => ({ equals: (value) => ({ toArray: async () => dbEntries.filter((entry) =>
      field === "book" ? entry.book === value : entry.book === value[0] && entry.chapter === value[1]) }) }),
    bulkGet: async (ids) => ids.map((id) => storedById.get(id)),
  } },
  bn: { allVocab: null, sameBookVocab: new Map(), scopedVocab: new Map() },
  Dd: (book, chapter) => `${book}::${chapter}`,
  $p: scope,
  isVocaStudyEligible: isStudyEligible,
  filterVocaStudyEntries: filterStudyEntries,
  ud: (_target, candidates) => candidates, // inspect the full choice-candidate pool
});
vm.runInContext(adapters, context);
const ids = (list) => Array.from(list, (entry) => entry.id).sort();
const due = dbEntries.map((entry) => ({ id: entry.id, dueDate: "2000-01-01", reviewCount: 7 }));
const dueSnapshot = JSON.stringify(due);
assert.deepEqual(ids(await context.fs()), ids(filterStudyEntries(dbEntries)));
assert.deepEqual(ids(await context.vi()), ids(filterStudyEntries(dbEntries)));
assert.deepEqual(ids((await context.Ad(due)).map((item) => item.vocab)), ids(filterStudyEntries(dbEntries)));
for (const book of ["V501", "V301", "V502"]) {
  const all = filterStudyEntries(dbEntries.filter((entry) => entry.book === book));
  assert.deepEqual(ids(await context.Ro(book)), ids(all));
  assert.deepEqual(ids(await context.vi(book, "all")), ids(all));
  assert.deepEqual(ids(await context.Ld(book)), ids(all));
  for (const chapter of new Set(all.map((entry) => entry.chapter))) {
    const expected = all.filter((entry) => entry.chapter === chapter);
    assert.deepEqual(ids(await context.vi(book, chapter)), ids(expected));
    assert.deepEqual(ids(await context.Ld(book, chapter)), ids(expected));
    const queued = await context.Ad(due, book, chapter);
    assert.deepEqual(ids(queued.map((item) => item.vocab)), ids(expected));
    assert.ok(queued.every((item) => item.reviewState.reviewCount === 7));
  }
}
assert.deepEqual(ids(await context.ph(originalV501.find(isStudyEligible))), ids(originalV501.filter(isStudyEligible)));
assert.equal(JSON.stringify(dbEntries), before, "Do not alter stored vocabulary");
assert.equal(JSON.stringify(due), dueSnapshot, "Do not alter review history");
console.log("V501 exclusions: 360 excluded / 2,619 active; all 507 marked entries, other books, legacy queues and stored history preserved");
