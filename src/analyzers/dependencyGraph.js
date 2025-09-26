const fs = require('fs');
const path = require('path');

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY_EXTENSIONS = new Set(['.py']);
const GO_EXTENSIONS = new Set(['.go']);

const RESOLUTION_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'];

function buildDependencyGraph(rootPath, files, options = {}) {
  const fileSet = new Set(files.map((file) => normalizePath(file.path)));
  const nodes = [];
  const edges = [];
  const unresolved = [];

  const maxFileSize = options.maxFileSize !== undefined ? options.maxFileSize : 256 * 1024; // re-read smaller files

  for (const file of files) {
    const normalizedPath = normalizePath(file.path);
    const node = {
      id: normalizedPath,
      path: normalizedPath,
      name: file.name,
      language: detectLanguageGroup(file.ext),
      dependencies: []
    };

    nodes.push(node);

    if (file.size > maxFileSize) {
      unresolved.push({
        source: normalizedPath,
        specifier: null,
        reason: 'File too large to inspect for dependencies'
      });
      continue;
    }

    const absPath = path.resolve(rootPath, file.path);
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (error) {
      unresolved.push({
        source: normalizedPath,
        specifier: null,
        reason: `Failed to read file: ${error.message}`
      });
      continue;
    }

    const specifiers = extractSpecifiers(content, file.ext);

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(specifier, normalizedPath, fileSet);
      const edge = {
        source: normalizedPath,
        target: resolved ? resolved.target : specifier,
        specifier,
        kind: resolved ? resolved.kind : 'external'
      };
      edges.push(edge);
      node.dependencies.push(edge);

      if (!resolved && isRelativeSpecifier(specifier)) {
        unresolved.push({
          source: normalizedPath,
          specifier,
          reason: 'Could not resolve locally'
        });
      }
    }
  }

  return { nodes, edges, unresolved };
}

function extractSpecifiers(content, ext) {
  if (JS_EXTENSIONS.has(ext)) {
    return extractJavaScriptSpecifiers(content);
  }
  if (PY_EXTENSIONS.has(ext)) {
    return extractPythonSpecifiers(content);
  }
  if (GO_EXTENSIONS.has(ext)) {
    return extractGoSpecifiers(content);
  }
  return [];
}

function extractJavaScriptSpecifiers(content) {
  const specifiers = new Set();
  const importRegex = /import\s+[^'"\n]+['"]([^'"\n]+)['"]/g;
  const dynamicImportRegex = /import\(['"]([^'"\n]+)['"]\)/g;
  const requireRegex = /require\(['"]([^'"\n]+)['"]\)/g;

  collectMatches(content, importRegex, specifiers);
  collectMatches(content, dynamicImportRegex, specifiers);
  collectMatches(content, requireRegex, specifiers);

  return [...specifiers];
}

function extractPythonSpecifiers(content) {
  const specifiers = new Set();
  const importRegex = /^\s*import\s+([\w.]+)/gm;
  const fromImportRegex = /^\s*from\s+([\w.]+)\s+import\s+.+$/gm;

  collectMatches(content, importRegex, specifiers, 1);
  collectMatches(content, fromImportRegex, specifiers, 1);

  return [...specifiers];
}

function extractGoSpecifiers(content) {
  const specifiers = new Set();
  const importBlockRegex = /import\s*\(([^)]+)\)/g;
  const singleImportRegex = /import\s+"([^"]+)"/g;

  let match;
  while ((match = importBlockRegex.exec(content))) {
    const block = match[1];
    const inner = block.match(/"([^"]+)"/g);
    if (inner) {
      inner.map((str) => str.replace(/"/g, '')).forEach((value) => specifiers.add(value));
    }
  }

  collectMatches(content, singleImportRegex, specifiers, 1);
  return [...specifiers];
}

function collectMatches(content, regex, bucket, captureIndex = 1) {
  let match;
  while ((match = regex.exec(content))) {
    bucket.add(match[captureIndex] !== undefined ? match[captureIndex] : (match[1] !== undefined ? match[1] : match[0]));
  }
}

function resolveSpecifier(specifier, sourcePath, fileSet) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null; // treat as external dependency
  }

  const sourceDir = path.posix.dirname(sourcePath);
  const potentialBase = normalizePath(path.posix.join(sourceDir, specifier));

  if (fileSet.has(potentialBase)) {
    return { kind: 'local', target: potentialBase };
  }

  const withExtensions = RESOLUTION_EXTENSIONS.map((ext) => `${potentialBase}${ext}`);
  for (const candidate of withExtensions) {
    if (fileSet.has(candidate)) {
      return { kind: 'local', target: candidate };
    }
  }

  const indexCandidates = RESOLUTION_EXTENSIONS.map((ext) => path.posix.join(potentialBase, `index${ext}`));
  for (const candidate of indexCandidates) {
    if (fileSet.has(candidate)) {
      return { kind: 'local', target: candidate };
    }
  }

  return null;
}

function detectLanguageGroup(ext) {
  if (JS_EXTENSIONS.has(ext)) return 'JavaScript/TypeScript';
  if (PY_EXTENSIONS.has(ext)) return 'Python';
  if (GO_EXTENSIONS.has(ext)) return 'Go';
  return 'Other';
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

module.exports = {
  buildDependencyGraph
};

function isRelativeSpecifier(specifier) {
  return specifier && (specifier.startsWith('.') || specifier.startsWith('/'));
}
