export interface DiffLine {
  kind: "same" | "added" | "removed";
  line: string;
  lineA: number | null;
  lineB: number | null;
}

/**
 * Compute a simple line-by-line diff of two JSON objects.
 * Both objects are pretty-printed before comparison.
 */
export function diffJson(before: unknown, after: unknown): DiffLine[] {
  const linesA = JSON.stringify(before, null, 2).split("\n");
  const linesB = JSON.stringify(after, null, 2).split("\n");
  return diffLines(linesA, linesB);
}

/**
 * Simple line diff using a longest-common-subsequence approach.
 *
 * For small JSON configs (< 100 lines) this is fast enough.
 */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const lcs = buildLcsTable(a, b);

  // Walk back through the LCS table to extract the diff
  let i = a.length;
  let j = b.length;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ kind: "same", line: a[i - 1], lineA: i, lineB: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      stack.push({ kind: "added", line: b[j - 1], lineA: null, lineB: j });
      j--;
    } else if (i > 0) {
      stack.push({ kind: "removed", line: a[i - 1], lineA: i, lineB: null });
      i--;
    }
  }

  return stack.reverse();
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] =
        a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  return table;
}
