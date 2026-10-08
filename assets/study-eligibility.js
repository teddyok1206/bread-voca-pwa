import { v501RedTerms } from "./v501-red-terms.js";

function normalizeWord(word) {
  return String(word ?? "").normalize("NFKC").replace(/[’‘]/g, "'")
    .trim().replace(/\s+/g, " ").toLowerCase();
}

const excludedIds = new Set(v501RedTerms.entries.map((entry) => entry.id).filter(Boolean));
const excludedTerms = new Set(v501RedTerms.entries.map((entry) => `${entry.chapter}::${normalizeWord(entry.word)}`));

export function isStudyEligible(entry) {
  if (!entry) return false;
  if (entry.book !== "V501") return true;
  // Match chapter + headword as well as stable IDs for already imported packs.
  // Do not suppress a black occurrence in another chapter or another book.
  const chapter = Number(entry.chapter ?? entry.sourcePage ?? entry.source_page);
  return !excludedIds.has(entry.id) && !excludedTerms.has(`${chapter}::${normalizeWord(entry.word)}`);
}

export function filterStudyEntries(entries) {
  return entries.filter(isStudyEligible);
}
