const FUNCTION_KINDS = new Set(['function', 'component']);
const CLASS_KINDS = new Set(['class']);

const LONG_FUNCTION_WARNING = 50;
const LONG_FUNCTION_ERROR = 100;
const PARAM_WARNING_THRESHOLD = 5;
const PARAM_ERROR_THRESHOLD = 8;
const BRANCH_WARNING_THRESHOLD = 15;
const BRANCH_ERROR_THRESHOLD = 25;
const LARGE_CLASS_METHOD_WARNING = 15;
const LARGE_CLASS_METHOD_ERROR = 25;

function detectCodeSmells(structureGraph) {
  const issues = [];
  if (!structureGraph || !Array.isArray(structureGraph.symbols)) {
    return issues;
  }

  structureGraph.symbols.forEach((symbol) => {
    if (!symbol || !symbol.text || !symbol.path) {
      return;
    }

    if (FUNCTION_KINDS.has(symbol.kind)) {
      issues.push(...detectFunctionSmells(symbol));
      return;
    }

    if (CLASS_KINDS.has(symbol.kind)) {
      issues.push(...detectClassSmells(symbol));
    }
  });

  return issues;
}

function detectFunctionSmells(symbol) {
  const issues = [];
  const lineSpan = computeLineSpan(symbol);
  const branchCount = countBranches(symbol.text);
  const paramCount = countParameters(symbol.text);

  if (lineSpan >= LONG_FUNCTION_WARNING) {
    issues.push(createIssue(symbol, lineSpan >= LONG_FUNCTION_ERROR ? 'error' : 'warning', 'long-function',
      `${symbol.name || 'Anonymous function'} spans ${lineSpan} lines. Consider extracting helpers.`));
  }

  if (paramCount >= PARAM_WARNING_THRESHOLD) {
    issues.push(createIssue(symbol, paramCount >= PARAM_ERROR_THRESHOLD ? 'warning' : 'info', 'many-parameters',
      `${symbol.name || 'Function'} takes ${paramCount} parameters; consider using objects to group data.`));
  }

  if (branchCount >= BRANCH_WARNING_THRESHOLD) {
    issues.push(createIssue(symbol, branchCount >= BRANCH_ERROR_THRESHOLD ? 'error' : 'warning', 'branch-heavy',
      `${symbol.name || 'Function'} contains ${branchCount} conditional/loop branches. Simplify control flow if possible.`));
  }

  return issues;
}

function detectClassSmells(symbol) {
  const issues = [];
  const lineSpan = computeLineSpan(symbol);
  const methodCount = countClassMethods(symbol.text);

  if (lineSpan >= LONG_FUNCTION_WARNING * 2) {
    issues.push(createIssue(symbol, lineSpan >= LONG_FUNCTION_ERROR * 2 ? 'error' : 'warning', 'large-class',
      `${symbol.name || 'Class'} spans ${lineSpan} lines. Break responsibilities into smaller classes or components.`));
  }

  if (methodCount >= LARGE_CLASS_METHOD_WARNING) {
    issues.push(createIssue(symbol, methodCount >= LARGE_CLASS_METHOD_ERROR ? 'error' : 'warning', 'many-methods',
      `${symbol.name || 'Class'} exposes ${methodCount} methods. Consider refactoring to reduce surface area.`));
  }

  return issues;
}

function computeLineSpan(symbol) {
  if (symbol.startLine && symbol.endLine) {
    const span = symbol.endLine - symbol.startLine + 1;
    if (span > 0) {
      return span;
    }
  }
  return countLines(symbol.text);
}

function countLines(text) {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function countBranches(text) {
  if (!text) {
    return 0;
  }
  const branchRegex = /(?:\bif\b|\belse\s+if\b|\bfor\b|\bwhile\b|\bswitch\b|\bcase\b|\bcatch\b|&&|\|\|)/g;
  const matches = text.match(branchRegex);
  return matches ? matches.length : 0;
}

function countParameters(text) {
  if (!text) {
    return 0;
  }
  const signatureMatch = text.match(/^[^{=>]*\(([^)]*)\)/m);
  if (!signatureMatch) {
    return 0;
  }
  const params = signatureMatch[1]
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^\.{3}/.test(p));
  return params.length;
}

function countClassMethods(text) {
  if (!text) {
    return 0;
  }
  const matches = text.match(/\n\s*(?:async\s+)?(?:static\s+)?[A-Za-z_][\w]*\s*\(/g);
  return matches ? matches.length : 0;
}

function createIssue(symbol, severity, type, message) {
  return {
    category: 'smell',
    severity,
    type,
    path: symbol.path,
    message,
    symbolId: symbol.id,
    line: symbol.startLine || null
  };
}

module.exports = {
  detectCodeSmells
};
