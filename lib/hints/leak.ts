import { LEAK_CHECK } from "../config";
import type { LeakResult } from "./types";

const KEYWORDS = new Set(
  (
    "break case catch class const continue default delete do else export extends finally for from function if import in " +
    "instanceof let new of return switch this throw try typeof var void while yield async await true false null undefined " +
    "map filter reduce sort slice split join push pop length"
  ).split(" "),
);

/** Remove block and line comments. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tokenize(line: string): string[] {
  return line.toLowerCase().match(/[a-z_$][\w$]*|\d+(?:\.\d+)?|[^\s\w]/g) ?? [];
}

/** Keep comment text but drop the markers, so code hidden inside comments still counts. */
export function unwrapComments(src: string): string {
  return src.replace(/\/\*|\*\/|(^|[^:])\/\//gm, "$1 ");
}

/** Lines of lowercase tokens, blank lines removed. Comments are stripped unless `keepComments`. */
export function normalizeLines(src: string, keepComments = false): string[][] {
  return (keepComments ? unwrapComments(src) : stripComments(src))
    .split("\n")
    .map(tokenize)
    .filter((t) => t.length > 0);
}

/** Flat token list with non-keyword identifiers collapsed, so renaming variables does not help. */
function canonicalTokens(src: string, keepComments: boolean): string[] {
  return normalizeLines(src, keepComments)
    .flat()
    .map((t) => (/^[a-z_$]/.test(t) && !KEYWORDS.has(t) ? "ID" : t));
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

/** Fraction of the solution's token n-grams that also appear in the hint (containment). */
function similarity(hint: string, solution: string, keepComments: boolean): number {
  const sol = ngrams(canonicalTokens(solution, false), LEAK_CHECK.ngramSize);
  if (sol.length === 0) return 0;
  const hintSet = new Set(ngrams(canonicalTokens(hint, keepComments), LEAK_CHECK.ngramSize));
  return sol.filter((g) => hintSet.has(g)).length / sol.length;
}

/** Longest run of consecutive substantive solution lines that each appear in the hint. */
function longestSharedLineRun(
  hint: string,
  solution: string,
  keepComments: boolean,
  canonical: boolean,
): number {
  // canonical=true also collapses identifiers, so renamed variables do not help.
  const norm = (t: string) => (canonical && /^[a-z_$]/.test(t) && !KEYWORDS.has(t) ? "ID" : t);
  const lines = normalizeLines(solution)
    .filter((l) => l.length >= LEAK_CHECK.minLineTokens)
    .map((l) => l.map(norm).join(" "));
  // Whitespace and line breaks in the hint are ignored, so reformatting does not help.
  const hintText = ` ${normalizeLines(hint, keepComments).flat().map(norm).join(" ")} `;
  // Each solution line must appear somewhere in the hint; prose between lines does not break a run.
  let best = 0;
  let run = 0;
  for (const line of lines) {
    run = hintText.includes(` ${line} `) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** H4: normalized token similarity plus contiguous-lines check. Fails closed on any error. */
export function leakCheck(hint: string, referenceSolution: string): LeakResult {
  try {
    if (typeof hint !== "string" || typeof referenceSolution !== "string" || referenceSolution.trim() === "") {
      return { leaked: true, reason: "invalid-input", score: 1 };
    }
    // Check the hint both with comments removed (interleaved chatter) and with comment
    // markers unwrapped (code hidden in comments); keep the worse result.
    const sim = Math.max(similarity(hint, referenceSolution, false), similarity(hint, referenceSolution, true));
    const run = Math.max(
      longestSharedLineRun(hint, referenceSolution, false, true),
      longestSharedLineRun(hint, referenceSolution, true, true),
    );
    if (run >= LEAK_CHECK.maxSharedLines) {
      return { leaked: true, reason: `shared-lines:${run}`, score: Math.max(sim, 1) };
    }
    if (sim > LEAK_CHECK.maxOverlapRatio) {
      return { leaked: true, reason: `similarity:${sim.toFixed(2)}`, score: sim };
    }
    return { leaked: false, reason: "ok", score: sim };
  } catch {
    return { leaked: true, reason: "check-error", score: 1 };
  }
}
