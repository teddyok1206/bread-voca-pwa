import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  createFieldQuestion,
  createFieldSubcategoryBuckets,
  prepareFieldBuckets,
} from "../assets/field-mode-core.js";
import { v301FieldLabels } from "../assets/v301-field-labels.js";

// This repository contains the deployed bundle, not the original React source.
// Exercise its actual field-mode JSX with deterministic loaded hook state.
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bundlePath = index.match(/<script[^>]+src="([^"]+)"/)[1];
const bundle = await readFile(new URL(bundlePath.split("?")[0], new URL("../", import.meta.url)), "utf8");
const component = bundle.slice(bundle.indexOf("function dC("), bundle.indexOf("function fC("));
assert.ok(component.startsWith("function dC("), "Locate the shipped field-mode component");
assert.ok(!component.includes("$.englishLabel"), "Prompt must not use translated labels");
assert.ok(!component.includes("sourceBucketEnglishLabel"), "Answer feedback uses original category meanings");

const pack = JSON.parse(await readFile(new URL("../vocab_pack.json", import.meta.url), "utf8"));
const jsx = (type, props) => ({ type, props });
function descendants(node) {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}
function content(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(content).join("");
  if (typeof node === "object") return content(node.props?.children);
  return String(node);
}

for (const book of ["V301", "V502"]) {
  const entries = pack.entries.filter((entry) => entry.book === book).map((entry) => ({
    ...entry, bucketId: entry.bucket_id, sourceLabel: entry.source_label,
  }));
  const buckets = book === "V301"
    ? createFieldSubcategoryBuckets(entries, v301FieldLabels)
    : prepareFieldBuckets(pack.semantic_buckets.filter((bucket) => bucket.book === book), entries);
  const target = book === "V301"
    ? buckets.find((bucket) => bucket.parentBucketId === "v301_02" && bucket.label === "추구하다")
    : buckets.find((bucket) => /[가-힣]/.test(bucket.label) && bucket.english_label !== bucket.label);
  assert.ok(target);
  const question = createFieldQuestion(target, buckets, () => 0.5);
  assert.notEqual(question.label, question.englishLabel, `${book}: meaningful translation regression fixture`);
  const outsider = question.options.find((option) => option.isOutsider);

  for (const answer of [null, outsider, question.options.find((option) => !option.isOutsider)]) {
    const state = [
      { allBuckets: buckets, scopedBuckets: buckets },
      { version: 1, order: buckets.map((bucket) => bucket.bucket_id), index: 0, correctCount: 0 },
      question, answer, false, null,
    ];
    let hook = 0;
    const sandbox = {
      te: { useState: () => [state[hook++], () => {}], useEffect: () => {} },
      p: { jsx, jsxs: jsx, Fragment: "fragment" },
      oC: () => "test-progress", Qu: () => null, cC: () => null, sC: () => "",
      props: { semanticBook: book, studyChapter: "all", onModeChange: () => {} },
    };
    const tree = vm.runInNewContext(`${component}; dC(props)`, sandbox);
    const nodes = descendants(tree);
    const prompt = nodes.find((node) => node.props?.className === "v301-prompt");
    assert.equal(descendants(prompt).find((node) => node.type === "strong").props.children, target.label);
    assert.ok(content(prompt).includes(`한글 ${book === "V301" ? "하위 범주" : "범주"} 뜻`));
    assert.ok(content(nodes.find((node) => node.type === "h2")).startsWith("한글 "));
    const options = nodes.filter((node) => node.type === "button" && node.props.className.startsWith("v301-option-button"));
    assert.deepEqual(options.map((node) => descendants(node).find((child) => child.type === "strong").props.children), question.options.map((option) => option.word));
    assert.ok(options.every((node) => node.props.disabled === Boolean(answer)));
    if (answer) {
      const feedback = nodes.find((node) => node.props?.className?.startsWith("answer-panel"));
      assert.ok(content(feedback).includes(`${outsider.word} · ${outsider.sourceBucketLabel}`));
    }
  }
}

const worker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
assert.ok(bundlePath.endsWith("?v=7"), "Deploy a fresh bundle URL without clearing learning data");
assert.ok(worker.includes('"voca-shell-v7"'), "Refresh only the service-worker shell cache");
console.log("field mode prompt: V301/V502 원문 한글 뜻·정답/오답 화면·영어 선택지 검증 완료");
