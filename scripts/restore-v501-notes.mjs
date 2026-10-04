// Usage: node scripts/restore-v501-notes.mjs /path/to/V501.pdf [--write]
// Requires Poppler's pdftotext. The original PDF stays outside the repository.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const pdfPath = process.argv[2];
assert.ok(pdfPath && !pdfPath.startsWith("--"), "Provide the locally downloaded V501 PDF");
const stat = fs.statSync(pdfPath);
assert.ok(stat.isFile() && stat.size > 0 && stat.blocks > 0, "Do not read an iCloud placeholder");
const result = spawnSync("pdftotext", ["-f", "1", "-l", "30", "-raw", pdfPath, "-"], {
  encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
});
assert.equal(result.status, 0, result.stderr);
const compact = s => s.replace(/\s+/g, " ").trim();
const normalize = s => compact(s.normalize("NFKC").replace(/[’‘]/g, "'")).toLowerCase();
const packPath = new URL("../vocab_pack.json", import.meta.url);
const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
const original = pack.entries.filter(e => e.book === "V501");
const notes = [];
const additions = new Map();
const idSet = new Set(pack.entries.map(e => e.id));
const pages = result.stdout.split("\f").filter(page => page.trim());
assert.equal(pages.length, 30, "Only DAY 01–30; exclude the repeated alphabetical indexes");

// Split meanings only outside annotations: '(감정, 생각 등을) 실행하다'
// must not yield '생각 등을) 실행하다' as a separate answer.
function answers(gloss) {
  let depth = 0, part = "";
  const parts = [gloss];
  for (const char of gloss) {
    if ("([（［".includes(char)) depth++;
    if (")]）］".includes(char)) depth--;
    if (depth === 0 && /[;,/|·•]/.test(char)) { parts.push(part); part = ""; }
    else part += char;
  }
  parts.push(part);
  const variants = parts.flatMap(text => {
    const full = compact(text);
    const bare = compact(full.replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/^[\s\-~]+/, "").replace(/^(?:을|를|의|에)\s+/, ""));
    return [full, bare, bare.endsWith("하다") ? bare.slice(0, -2) : ""];
  });
  return [...new Set(variants.filter(Boolean))];
}

pages.forEach((page, index) => {
  const pageNumber = index + 1;
  assert.ok(page.includes("LOGIC TREE V501 ver. 11.1"), `Unexpected edition on page ${pageNumber}`);
  assert.ok(new RegExp(`DAY\\s+0?${pageNumber}(?:\\s|$)`).test(page), `Missing DAY ${pageNumber}`);
  // Raw extraction follows each column top-to-bottom, unlike layout extraction.
  // Join headwords whose colon/meaning starts on the next line.
  const lines = page.replace(/([^\n])\n\s*:/g, "$1:").split("\n").map(compact).filter(Boolean);
  const tokens = [];
  let current = null;
  for (const line of lines) {
    if (/^(?:LOGIC TREE|DAY|VOCABULARY|- \d+ -)/.test(line)) { current = null; continue; }
    const match = /^(※?)([^:]+):\s*(.*)$/.exec(line);
    if (match) {
      current = { marked: Boolean(match[1]), word: compact(match[2]), gloss: compact(match[3]) };
      tokens.push(current);
    } else {
      assert.ok(!line.includes("※"), `Unparsed marker on page ${pageNumber}: ${line}`);
      if (current) current.gloss = compact(`${current.gloss} ${line}`);
    }
  }
  const existing = original.filter(e => e.source_page === pageNumber);
  const consumed = new Set();
  for (const token of tokens) {
    token.entry = existing.find(e => !consumed.has(e.id) && normalize(e.word) === normalize(token.word));
    if (token.entry) consumed.add(token.entry.id);
  }
  let anchor = null, ordinal = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.marked) {
      ordinal++;
      assert.ok(token.word && /[가-힣]/.test(token.gloss), `Incomplete note on page ${pageNumber}`);
      let entry = token.entry;
      if (entry && !entry.accepted_answers.includes(token.gloss)) {
        entry.accepted_answers.push(token.gloss);
      }
      if (!entry) {
        assert.ok(anchor, `No study-order anchor for ${token.word}`);
        const prefix = /^v501_(\d+)_/.exec(anchor.id)?.[1];
        assert.ok(prefix);
        // Nd() sorts by the numeric ID then by the full ID. Share the previous
        // word's number, with a suffix after its slug, to insert notes in PDF
        // order without changing IDs referenced by existing review history.
        const slug = normalize(token.word).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        const id = `v501_${prefix}_zz_note_${String(pageNumber).padStart(2, "0")}_${String(ordinal).padStart(2, "0")}_${slug}`;
        assert.ok(!idSet.has(id), `Duplicate ID ${id}`);
        idSet.add(id);
        entry = {
          id, word: token.word, book: "V501", chapter: pageNumber, type: "flat",
          accepted_answers: answers(token.gloss), source_page: pageNumber, raw_gloss: token.gloss,
        };
        const next = tokens.slice(i + 1).find(t => t.entry)?.entry;
        assert.ok(next, `No following entry for ${token.word}`);
        additions.set(next.id, [...(additions.get(next.id) ?? []), entry]);
      }
      notes.push({ page: pageNumber, word: token.word, gloss: token.gloss, id: entry.id });
    }
    if (token.entry) anchor = token.entry;
  }
});
assert.equal(notes.length, 507, "V501 ver. 11.1 has 507 marked entries on DAY 01–30");
assert.equal(new Set(notes.map(n => `${n.page}|${normalize(n.word)}`)).size, notes.length);

let cleaned = 0;
for (const entry of original) {
  if (entry.raw_gloss.endsWith(" ※")) {
    entry.raw_gloss = entry.raw_gloss.replace(/\s*※$/, "");
    entry.accepted_answers = entry.accepted_answers.map(a => a.replace(/\s*※$/, ""));
    cleaned++;
  }
}
const added = [...additions.values()].reduce((count, group) => count + group.length, 0);
pack.entries = pack.entries.flatMap(e => [...(additions.get(e.id) ?? []), e]);
pack.stats.entry_count += added;
pack.stats.entries_by_book.V501 += added;
pack.stats.entries_by_type.flat += added;
for (const chapter of pack.stats.chapter_counts.filter(c => c.book === "V501")) {
  chapter.count = pack.entries.filter(e => e.book === "V501" && e.chapter === chapter.chapter).length;
}
const audit = {
  source_file: "V501.pdf", source_version: "11.1",
  source_sha256: createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex"),
  study_pages: 30, marker_count: notes.length, entries: notes,
};
if (process.argv.includes("--write")) {
  fs.writeFileSync(packPath, JSON.stringify(pack, null, 2) + "\n");
  fs.writeFileSync(new URL("../tests/fixtures/v501-marked-entries.json", import.meta.url), JSON.stringify(audit, null, 2) + "\n");
}
console.log(JSON.stringify({marked: notes.length, added, cleaned, v501_total: pack.stats.entries_by_book.V501, write: process.argv.includes("--write")}));
