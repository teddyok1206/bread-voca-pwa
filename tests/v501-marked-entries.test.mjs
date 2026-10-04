import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pack = JSON.parse(await readFile(new URL("../vocab_pack.json", import.meta.url), "utf8"));
const audit = JSON.parse(await readFile(new URL("./fixtures/v501-marked-entries.json", import.meta.url), "utf8"));
const entries = pack.entries.filter(e => e.book === "V501");
assert.equal(audit.marker_count, 507);
assert.equal(audit.entries.length, 507);
assert.equal(entries.length, 2979);
assert.equal(new Set(pack.entries.map(e => e.id)).size, pack.entries.length);

const byId = new Map(entries.map(e => [e.id, e]));
for (const note of audit.entries) {
  const entry = byId.get(note.id);
  assert.ok(entry, `${note.word}: missing marked entry`);
  assert.equal(entry.word, note.word);
  assert.equal(entry.chapter, note.page);
  assert.equal(entry.source_page, note.page);
  assert.equal(entry.raw_gloss, note.gloss);
  assert.ok(entry.accepted_answers.includes(note.gloss));
  assert.ok(!entry.word.includes("※"));
}

// Mirror the existing browser's order: numeric ID, then the complete ID.
const order = entries.slice().sort((a, b) => a.chapter - b.chapter ||
  Number(/^v501_(\d+)_/.exec(a.id)[1]) - Number(/^v501_(\d+)_/.exec(b.id)[1]) ||
  a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" }));
const markedIds = new Set(audit.entries.map(n => n.id));
assert.deepEqual(order.filter(e => markedIds.has(e.id)).map(e => e.id), audit.entries.map(n => n.id));
const keepAbreast = order.findIndex(e => e.word === "keep abreast with" && e.chapter === 1);
const runAmuck = order.findIndex(e => e.word === "run amuck" && e.chapter === 1);
assert.equal(order[keepAbreast - 1].word, "annihilate");
assert.equal(order[runAmuck + 1].word, "malice aforethought");
assert.equal(byId.get("v501_0336_when_it_comes_to_the_crunch").word, "when it comes to the crunch");
assert.equal(byId.get("v501_0966_make_good_on").word, "make good on");
assert.equal(order.find(e => e.word === "There is more than one way to skin a cat").raw_gloss,
  "한 가지 일을 하는 데는 여러 가지 방법이 있다");
assert.equal(order.find(e => e.word === "in turn").raw_gloss,
  "A가 B에 영향을 미치고, B가 다시 C에 영향을 미칠 때, B와 C사이에 쓰는 말");
assert.deepEqual(order.find(e => e.word === "act out").accepted_answers,
  ["(감정, 생각 등을) 실행하다", "실행하다", "실행"]);
assert.ok(entries.every(e => !e.raw_gloss.includes("※") && e.accepted_answers.every(a => !a.includes("※"))));

assert.equal(pack.stats.entry_count, pack.entries.length);
assert.equal(pack.stats.entries_by_book.V501, entries.length);
assert.equal(pack.stats.entries_by_type.flat, pack.entries.filter(e => e.type === "flat").length);
for (const { chapter, count } of pack.stats.chapter_counts.filter(c => c.book === "V501")) {
  assert.equal(entries.filter(e => e.chapter === chapter).length, count);
}
console.log("V501: 507 marked entries are complete, in the original chapters and PDF order");
