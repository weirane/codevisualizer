const MIN_TOKENS = 5;
const MAX_PAIRS = 250000;
const DEFAULT_THRESHOLD = 0.55;
const SHINGLE_SIZE = 3;
const WINDOW_SIZE = 4;
const MAX_MATCHES_PER_PAIR = 200;
const JS_FAMILY = new Set([
  "javascript",
  "typescript",
  "js",
  "ts",
  "jsx",
  "tsx",
]);

function findSymbolClones(
  rootPath,
  symbolEntries,
  threshold = DEFAULT_THRESHOLD
) {
  const results = new Map();
  if (!Array.isArray(symbolEntries) || symbolEntries.length === 0) {
    return Object.fromEntries(results);
  }

  // Restrict detection strictly to function-level units (regular functions and function components)
  const symbols = symbolEntries
    .filter((entry) => isFunctionLike(entry))
    .map((entry) => enrichSymbol(rootPath, entry))
    .filter(Boolean);

  if (symbols.length === 0) {
    return Object.fromEntries(results);
  }

  let comparisons = 0;
  for (let i = 0; i < symbols.length; i += 1) {
    const a = symbols[i];
    for (let j = i + 1; j < symbols.length; j += 1) {
      if (comparisons >= MAX_PAIRS) {
        break;
      }
      const b = symbols[j];
      if (!languagesAreCompatible(a.language, b.language)) {
        continue;
      }
      const shareFingerprints = hasSharedFingerprints(a, b);
      const overlap = shareFingerprints ? computeSymbolOverlap(a, b) : null;
      const dice = diceCoefficient(
        a.tokenCounts,
        a.tokenTotal,
        b.tokenCounts,
        b.tokenTotal
      );
      const similarity = overlap ? Math.max(overlap.similarity, dice) : dice;
      comparisons += 1;
      if (similarity >= threshold) {
        const rangeForB = overlap
          ? segmentsToLines(b, overlap.segmentsB)
          : null;
        const rangeForA = overlap
          ? segmentsToLines(a, overlap.segmentsA)
          : null;
        addClone(results, a, b, similarity, rangeForB);
        addClone(results, b, a, similarity, rangeForA);
      }
    }
  }

  return Object.fromEntries(results);
}

function isFunctionLike(entry) {
  if (!entry) {
    return false;
  }
  const kind = String(entry.kind || "").toLowerCase();
  // Treat standard functions and React-style function components as function-level units
  return kind === "function" || kind === "component";
}

function enrichSymbol(rootPath, symbol) {
  if (!symbol || !symbol.text || !symbol.id) {
    return null;
  }

  const { tokens, offsets, lengths } = tokenizeWithMeta(symbol.text);
  if (tokens.length < MIN_TOKENS) {
    return null;
  }
  const { fingerprints, fingerprintIndex, fingerprintHashes } =
    computeFingerprints(tokens, SHINGLE_SIZE, WINDOW_SIZE);
  const tokenCounts = buildTokenCounts(tokens);
  const lineOffsets = buildLineOffsets(symbol.text || "");

  return {
    id: symbol.id,
    path: symbol.path,
    fileId: symbol.fileId || `file:${symbol.path}`,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    language: symbol.language,
    tokens,
    tokenOffsets: offsets,
    tokenLengths: lengths,
    lineOffsets,
    fingerprints,
    fingerprintIndex,
    fingerprintHashes,
    tokenCounts,
    tokenTotal: tokens.length,
  };
}

function tokenizeWithMeta(text) {
  if (!text) {
    return { tokens: [], offsets: [], lengths: [] };
  }

  const sanitized = stripCommentsPreserveLayout(text);
  const regex = /[A-Za-z0-9_]+/g;
  const tokens = [];
  const offsets = [];
  const lengths = [];
  let match;
  while ((match = regex.exec(sanitized))) {
    const token = match[0].toLowerCase();
    if (!token || /^_$/.test(token)) {
      continue;
    }
    tokens.push(token);
    offsets.push(match.index);
    lengths.push(match[0].length);
    if (tokens.length >= 5000) {
      break;
    }
  }

  return { tokens, offsets, lengths };
}

function stripCommentsPreserveLayout(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, (match) => match.replace(/[^\n]/g, " "));
}

function buildTokenCounts(tokens) {
  const counts = new Map();
  tokens.forEach((token) => {
    counts.set(token, (counts.get(token) || 0) + 1);
  });
  return counts;
}

function computeFingerprints(tokens, shingleSize, windowSize) {
  if (!Array.isArray(tokens) || tokens.length < shingleSize) {
    return {
      fingerprints: [],
      fingerprintIndex: new Map(),
      fingerprintHashes: new Set(),
    };
  }

  const hashes = [];
  for (let i = 0; i <= tokens.length - shingleSize; i += 1) {
    hashes.push({
      hash: hashShingle(tokens, i, shingleSize),
      index: i,
    });
  }

  const fingerprints = winnow(hashes, windowSize);
  const fingerprintIndex = new Map();
  fingerprints.forEach((fp) => {
    if (!fingerprintIndex.has(fp.hash)) {
      fingerprintIndex.set(fp.hash, []);
    }
    const arr = fingerprintIndex.get(fp.hash);
    if (arr.length < 64) {
      arr.push(fp.index);
    }
  });

  const fingerprintHashes = new Set(fingerprintIndex.keys());

  return { fingerprints, fingerprintIndex, fingerprintHashes };
}

function hashShingle(tokens, start, length) {
  let hash = 0;
  const prime = 1000003;
  for (let i = 0; i < length; i += 1) {
    const value = tokens[start + i];
    for (let j = 0; j < value.length; j += 1) {
      hash = (hash * 31 + value.charCodeAt(j)) % prime;
    }
    hash = (hash * 131 + 1) % prime;
  }
  return hash;
}

function winnow(hashes, windowSize) {
  if (!hashes.length || windowSize <= 0) {
    return [];
  }
  if (hashes.length <= windowSize) {
    const min = hashes.reduce((best, current) => {
      if (
        !best ||
        current.hash < best.hash ||
        (current.hash === best.hash && current.index > best.index)
      ) {
        return current;
      }
      return best;
    }, null);
    return min ? [min] : [];
  }

  const fingerprints = [];
  let windowStart = 0;
  let windowEnd = windowSize - 1;
  let minIndex = -1;

  const pushFingerprint = (candidate) => {
    const prev = fingerprints[fingerprints.length - 1];
    if (
      !prev ||
      prev.hash !== candidate.hash ||
      prev.index !== candidate.index
    ) {
      fingerprints.push(candidate);
    }
  };

  while (windowEnd < hashes.length) {
    if (minIndex < windowStart) {
      minIndex = windowStart;
      for (let i = windowStart; i <= windowEnd; i += 1) {
        const current = hashes[i];
        const min = hashes[minIndex];
        if (
          current.hash < min.hash ||
          (current.hash === min.hash && current.index > min.index)
        ) {
          minIndex = i;
        }
      }
      pushFingerprint(hashes[minIndex]);
    } else {
      const next = hashes[windowEnd];
      const min = hashes[minIndex];
      if (
        next.hash < min.hash ||
        (next.hash === min.hash && next.index > min.index)
      ) {
        minIndex = windowEnd;
        pushFingerprint(next);
      }
    }
    windowStart += 1;
    windowEnd += 1;
  }

  return fingerprints;
}

function hasSharedFingerprints(a, b) {
  if (!a || !b) {
    return false;
  }
  const smaller =
    a.fingerprintHashes.size <= b.fingerprintHashes.size
      ? a.fingerprintHashes
      : b.fingerprintHashes;
  const larger =
    smaller === a.fingerprintHashes ? b.fingerprintHashes : a.fingerprintHashes;
  for (const hash of smaller) {
    if (larger.has(hash)) {
      return true;
    }
  }
  return false;
}

function computeSymbolOverlap(a, b) {
  const shared = [];
  a.fingerprintHashes.forEach((hash) => {
    if (b.fingerprintHashes.has(hash)) {
      shared.push(hash);
    }
  });

  if (!shared.length) {
    return null;
  }

  const segmentsA = [];
  const segmentsB = [];
  const seenPairs = new Set();

  for (const hash of shared) {
    const positionsA = a.fingerprintIndex.get(hash) || [];
    const positionsB = b.fingerprintIndex.get(hash) || [];
    for (const idxA of positionsA) {
      for (const idxB of positionsB) {
        if (seenPairs.size >= MAX_MATCHES_PER_PAIR) {
          break;
        }
        const key = `${idxA}:${idxB}`;
        if (seenPairs.has(key)) {
          continue;
        }
        seenPairs.add(key);
        const match = extendMatch(a.tokens, b.tokens, idxA, idxB, SHINGLE_SIZE);
        if (match) {
          segmentsA.push({ start: match.startA, end: match.endA });
          segmentsB.push({ start: match.startB, end: match.endB });
        }
      }
      if (seenPairs.size >= MAX_MATCHES_PER_PAIR) {
        break;
      }
    }
    if (seenPairs.size >= MAX_MATCHES_PER_PAIR) {
      break;
    }
  }

  if (!segmentsA.length || !segmentsB.length) {
    return null;
  }

  const mergedA = mergeSegments(segmentsA);
  const mergedB = mergeSegments(segmentsB);

  if (!mergedA.length || !mergedB.length) {
    return null;
  }

  const overlapTokens = mergedA.reduce(
    (sum, seg) => sum + (seg.end - seg.start + 1),
    0
  );
  const denominator = Math.max(a.tokens.length, b.tokens.length);
  if (denominator === 0) {
    return null;
  }

  return {
    similarity: overlapTokens / denominator,
    segmentsA: mergedA,
    segmentsB: mergedB,
  };
}

function extendMatch(tokensA, tokensB, idxA, idxB, shingleSize) {
  if (!tokensA || !tokensB) {
    return null;
  }
  const limit = Math.min(tokensA.length - idxA, tokensB.length - idxB);
  if (limit < shingleSize) {
    return null;
  }

  let startA = idxA;
  let startB = idxB;
  while (
    startA > 0 &&
    startB > 0 &&
    tokensA[startA - 1] === tokensB[startB - 1]
  ) {
    startA -= 1;
    startB -= 1;
  }

  let endA = idxA + shingleSize - 1;
  let endB = idxB + shingleSize - 1;
  while (
    endA + 1 < tokensA.length &&
    endB + 1 < tokensB.length &&
    tokensA[endA + 1] === tokensB[endB + 1]
  ) {
    endA += 1;
    endB += 1;
  }

  return {
    startA,
    endA,
    startB,
    endB,
  };
}

function mergeSegments(segments) {
  if (!segments.length) {
    return [];
  }
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

function segmentsToLines(symbol, segments) {
  if (!symbol || !Array.isArray(segments) || !segments.length) {
    return {
      startLine: symbol ? symbol.startLine : null,
      endLine: symbol ? symbol.endLine : null,
    };
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const startOffset = symbol.tokenOffsets[first.start] || 0;
  const endTokenOffset =
    symbol.tokenOffsets[last.end] !== undefined
      ? symbol.tokenOffsets[last.end] + (symbol.tokenLengths[last.end] || 0)
      : symbol.tokenOffsets[first.start] || 0;

  const startLine =
    symbol.startLine + locateLine(startOffset, symbol.lineOffsets) - 1;
  const endLine =
    symbol.startLine +
    locateLine(Math.max(endTokenOffset - 1, 0), symbol.lineOffsets) -
    1;

  return {
    startLine: startLine || symbol.startLine,
    endLine: endLine || symbol.endLine,
  };
}

function buildLineOffsets(content) {
  const offsets = [0];
  let index = 0;
  while (index < content.length) {
    const next = content.indexOf("\n", index);
    if (next === -1) {
      break;
    }
    offsets.push(next + 1);
    index = next + 1;
  }
  return offsets;
}

function locateLine(position, offsets) {
  if (!offsets || offsets.length === 0) {
    return 1;
  }
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = offsets[mid];
    const next = offsets[mid + 1] ?? Infinity;
    if (position < start) {
      high = mid - 1;
    } else if (position >= next) {
      low = mid + 1;
    } else {
      return mid + 1;
    }
  }
  return offsets.length;
}

function normalizeLanguage(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).toLowerCase();
  if (JS_FAMILY.has(normalized)) {
    return "js-family";
  }
  return normalized;
}

function languagesAreCompatible(a, b) {
  const normA = normalizeLanguage(a);
  const normB = normalizeLanguage(b);
  if (!normA || !normB) {
    return true;
  }
  return normA === normB;
}

function diceCoefficient(countsA, totalA, countsB, totalB) {
  if (!countsA || !countsB || !totalA || !totalB) {
    return 0;
  }
  let intersection = 0;
  countsA.forEach((count, token) => {
    if (countsB.has(token)) {
      intersection += Math.min(count, countsB.get(token));
    }
  });
  const combined = totalA + totalB;
  if (combined === 0) {
    return 0;
  }
  return (2 * intersection) / combined;
}

function addClone(map, source, target, similarity, range) {
  if (!map.has(source.id)) {
    map.set(source.id, []);
  }
  const startLine =
    range && range.startLine ? range.startLine : target.startLine;
  const endLine = range && range.endLine ? range.endLine : target.endLine;
  map.get(source.id).push({
    targetId: target.id,
    filePath: target.path,
    startLine,
    endLine,
    similarity: Number(similarity.toFixed(2)),
  });
}

module.exports = {
  findSymbolClones,
};
