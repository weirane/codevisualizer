const fs = require("fs");
const path = require("path");
const { detectLanguage } = require("./language");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const MAX_FILE_BYTES = 256 * 1024;
const MAX_SYMBOL_BYTES = 128 * 1024;

function buildStructureGraph(rootPath, files, metricsByFile, dependencies) {
  const normalizedRoot = path.resolve(rootPath);
  const fileNodes = new Map();
  const packageNodes = new Map();
  const symbolNodes = new Map();
  const edges = [];
  const symbolDetails = [];
  const incomingCalls = new Map(); // symbolId -> Set of caller symbolIds
  const exportsByFile = new Map(); // filePath -> Set(exportName)
  const importsByFile = new Map(); // filePath -> Array<{ specifier, names:Set<string>, hasNamespace:boolean }>

  const metricsMap =
    metricsByFile instanceof Map
      ? metricsByFile
      : new Map(Object.entries(metricsByFile || {}));

  files.forEach((file) => {
    const normalizedPath = normalizePath(file.path);
    const id = `file:${normalizedPath}`;
    const metrics =
      metricsMap.get(file.path) || metricsMap.get(normalizedPath) || {};
    const language = detectLanguage(file.ext || path.extname(file.path));
    const node = {
      id,
      kind: "file",
      name: file.name,
      path: normalizedPath,
      language,
      group: getGroupFromPath(normalizedPath),
      metrics: {
        size: file.size,
        lineCount: metrics.lineCount || null,
        complexityScore: metrics.complexityScore || null,
      },
    };
    fileNodes.set(id, node);

    const pkgId = getPackageNodeId(normalizedPath);
    if (pkgId) {
      if (!packageNodes.has(pkgId)) {
        packageNodes.set(pkgId, {
          id: pkgId,
          kind: "package",
          name: pkgId.replace("package:", ""),
          path: pkgId.replace("package:", ""),
          metrics: {},
        });
      }
      edges.push({
        source: pkgId,
        target: id,
        type: "contains",
      });
    }

    const symbols = extractSymbolsForFile(normalizedRoot, file, language);
    const functionSymbolIdsByName = new Map();
    symbols.forEach((symbol) => {
      const symbolId = symbol.id;
      if (!symbolNodes.has(symbolId)) {
        symbolNodes.set(symbolId, {
          id: symbolId,
          kind: symbol.kind,
          name: symbol.name,
          path: normalizedPath,
          language,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
        });
      }
      symbolDetails.push(symbol);
      edges.push({
        source: id,
        target: symbolId,
        type: "defines",
      });

      // Track top-level function/component symbols by name for intra-file call mapping
      if (symbol.kind === "function" || symbol.kind === "component") {
        functionSymbolIdsByName.set(symbol.name, symbolId);
      }
    });

    // Extract intra-file calls and map to known top-level function/component symbols
    try {
      const calls = extractCallsForFile(normalizedRoot, file, language);
      for (const call of calls) {
        const calleeId = functionSymbolIdsByName.get(call.calleeName);
        const callerId = functionSymbolIdsByName.get(call.callerName);
        if (!calleeId || !callerId) {
          continue;
        }
        if (!incomingCalls.has(calleeId)) {
          incomingCalls.set(calleeId, new Set());
        }
        incomingCalls.get(calleeId).add(callerId);
      }
    } catch (_) {
      // best-effort; ignore call extraction errors
    }

    // Extract exports and imports for usage accounting
    try {
      const expImp = extractExportsAndImportsForFile(
        normalizedRoot,
        file,
        language
      );
      if (expImp && expImp.exportNames && expImp.exportNames.size) {
        exportsByFile.set(normalizedPath, new Set(expImp.exportNames));
      }
      if (expImp && expImp.imports && expImp.imports.length) {
        importsByFile.set(normalizedPath, expImp.imports);
      }
    } catch (_) {
      // ignore export/import extraction errors
    }
  });

  const dependencyEdges = Array.isArray(dependencies && dependencies.edges)
    ? dependencies.edges
    : [];
  dependencyEdges.forEach((dep) => {
    if (!dep || dep.kind !== "local") {
      return;
    }
    const source = `file:${normalizePath(dep.source)}`;
    const target = `file:${normalizePath(dep.target)}`;

    if (fileNodes.has(source) && fileNodes.has(target)) {
      edges.push({
        source,
        target,
        type: "import",
      });
    }
  });

  const nodes = [
    ...packageNodes.values(),
    ...fileNodes.values(),
    ...symbolNodes.values(),
  ];

  // Build mapping from (sourceFile, specifier) -> resolved target local file using dependency graph edges
  const resolution = new Map(); // key: `${source}::${specifier}` -> targetFilePath
  const depEdgesForResolution = Array.isArray(
    dependencies && dependencies.edges
  )
    ? dependencies.edges
    : [];
  depEdgesForResolution.forEach((dep) => {
    if (!dep || dep.kind !== "local") return;
    const key = `${normalizePath(dep.source)}::${dep.specifier}`;
    resolution.set(key, normalizePath(dep.target));
  });

  // Compute export usage: per exported identifier, number of unique importer files
  const exportUsage = new Map(); // key: `${filePath}#${exportName}` -> Set of importer files
  importsByFile.forEach((imports, sourceFile) => {
    if (!Array.isArray(imports)) return;
    // dedupe by target+exportName per sourceFile
    const seenPerSource = new Set();
    imports.forEach((imp) => {
      const target = resolution.get(`${sourceFile}::${imp.specifier}`);
      if (!target) return;
      const exportSet = exportsByFile.get(target) || new Set();
      if (imp.hasNamespace) {
        // Namespace import: consider all exports as used
        exportSet.forEach((name) => {
          const key = `${target}#${name}`;
          const uniqueKey = `${key}::${sourceFile}`;
          if (seenPerSource.has(uniqueKey)) return;
          seenPerSource.add(uniqueKey);
          if (!exportUsage.has(key)) exportUsage.set(key, new Set());
          exportUsage.get(key).add(sourceFile);
        });
        return;
      }
      // Named/default imports
      (imp.names || new Set()).forEach((name) => {
        const exportName = name || "default";
        if (!exportSet.has(exportName)) return; // ignore names not exported by target
        const key = `${target}#${exportName}`;
        const uniqueKey = `${key}::${sourceFile}`;
        if (seenPerSource.has(uniqueKey)) return;
        seenPerSource.add(uniqueKey);
        if (!exportUsage.has(key)) exportUsage.set(key, new Set());
        exportUsage.get(key).add(sourceFile);
      });
    });
  });

  return {
    nodes,
    edges,
    symbols: symbolDetails,
    incomingCalls: Object.fromEntries(
      [...incomingCalls.entries()].map(([k, v]) => [k, (v && v.size) || 0])
    ),
    exports: Object.fromEntries(
      [...exportsByFile.entries()].map(([filePath, set]) => [
        filePath,
        [...set],
      ])
    ),
    exportUsage: Object.fromEntries(
      [...exportUsage.entries()].map(([k, set]) => [k, (set && set.size) || 0])
    ),
    totals: {
      packages: packageNodes.size,
      files: fileNodes.size,
      symbols: symbolNodes.size,
      relations: edges.length,
    },
  };
}

function extractSymbolsForFile(rootPath, file, language) {
  const absPath = path.resolve(rootPath, file.path);
  if (!fs.existsSync(absPath)) {
    return [];
  }

  if (file.size > MAX_FILE_BYTES) {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch (error) {
    return [];
  }

  return extractSymbolsFromContent(content, file.path, language);
}

function extractSymbolsFromContent(content, relativePath, language) {
  // Prefer AST-based extraction for JS/TS; fallback otherwise
  const isJs = language === "JavaScript" || language === "TypeScript";
  if (!isJs) {
    return createFallbackSymbol(content, relativePath, language);
  }

  const entries = [];
  let ast;
  try {
    ast = babelParser.parse(content, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      ranges: true,
      tokens: false,
      plugins: [
        "jsx",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "dynamicImport",
        "exportDefaultFrom",
        "exportNamespaceFrom",
        "topLevelAwait",
        ...(language === "TypeScript" ? ["typescript"] : []),
      ],
    });
  } catch (err) {
    return createFallbackSymbol(content, relativePath, language);
  }

  const program = ast && ast.program;
  const isTopLevel = (p) => p && p.parentPath && p.parentPath.isProgram();
  const pushEntry = (name, kind, start, end, startLine, endLine) => {
    if (!name || !Number.isFinite(start) || !Number.isFinite(end)) return;
    const normalizedPath = normalizePath(relativePath);
    const id = `${kind}:${normalizedPath}#${name}`;
    const snippet = content.slice(
      start,
      Math.min(end, start + MAX_SYMBOL_BYTES)
    );
    entries.push({
      id,
      fileId: `file:${normalizedPath}`,
      name,
      kind,
      path: normalizedPath,
      language,
      startLine: startLine || 1,
      endLine: endLine || startLine || 1,
      text: snippet,
    });
  };

  traverse(ast, {
    ClassDeclaration(path) {
      if (!isTopLevel(path)) return;
      const id = path.node.id;
      const name = (id && id.name) || "default";
      const kind = classifySymbol(name, "class");
      const { start, end, loc } = path.node;
      pushEntry(
        name,
        kind,
        start,
        end,
        loc && loc.start && loc.start.line,
        loc && loc.end && loc.end.line
      );
    },
    FunctionDeclaration(path) {
      if (!isTopLevel(path)) return;
      const id = path.node.id;
      const name = (id && id.name) || "default";
      const kind = classifySymbol(name, "function");
      const { start, end, loc } = path.node;
      pushEntry(
        name,
        kind,
        start,
        end,
        loc && loc.start && loc.start.line,
        loc && loc.end && loc.end.line
      );
    },
    VariableDeclarator(path) {
      if (!isTopLevel(path)) return;
      const init = path.node.init;
      // Include variables that are functions as before; for non-function top-level exported values
      // we'll rely on export-aware extraction below for usage listing.
      if (
        !init ||
        (init.type !== "FunctionExpression" &&
          init.type !== "ArrowFunctionExpression")
      )
        return;
      const id = path.node.id;
      const name = (id && id.name) || "default";
      const kind = classifySymbol(name, "function");
      const { start, end, loc } = init;
      pushEntry(
        name,
        kind,
        start,
        end,
        loc && loc.start && loc.start.line,
        loc && loc.end && loc.end.line
      );
    },
    ExportDefaultDeclaration(path) {
      if (!isTopLevel(path)) return;
      const decl = path.node.declaration;
      if (!decl) return;
      if (decl.type === "FunctionDeclaration") {
        const name = (decl.id && decl.id.name) || "default";
        const kind = classifySymbol(name, "function");
        const { start, end, loc } = decl;
        pushEntry(
          name,
          kind,
          start,
          end,
          loc && loc.start && loc.start.line,
          loc && loc.end && loc.end.line
        );
      } else if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        const name = "default";
        const kind = classifySymbol(name, "function");
        const { start, end, loc } = decl;
        pushEntry(
          name,
          kind,
          start,
          end,
          loc && loc.start && loc.start.line,
          loc && loc.end && loc.end.line
        );
      }
    },
  });

  if (entries.length === 0) {
    return createFallbackSymbol(content, relativePath, language);
  }

  return dedupeById(entries);
}

function extractCallsForFile(rootPath, file, language) {
  const absPath = path.resolve(rootPath, file.path);
  if (!fs.existsSync(absPath)) {
    return [];
  }

  if (file.size > MAX_FILE_BYTES) {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch (error) {
    return [];
  }

  // Only JS/TS supported for call extraction
  const isJs = language === "JavaScript" || language === "TypeScript";
  if (!isJs) {
    return [];
  }

  let ast;
  try {
    ast = babelParser.parse(content, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      ranges: true,
      tokens: false,
      plugins: [
        "jsx",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "dynamicImport",
        "exportDefaultFrom",
        "exportNamespaceFrom",
        "topLevelAwait",
        ...(language === "TypeScript" ? ["typescript"] : []),
      ],
    });
  } catch (err) {
    return [];
  }

  const calls = [];

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      // Only consider simple identifier calls: foo()
      if (!callee || callee.type !== "Identifier") {
        return;
      }
      const calleeName = callee.name;
      if (!calleeName) return;

      const callerName = getEnclosingTopLevelFunctionName(path);
      if (!callerName || callerName === calleeName) return;

      calls.push({ callerName, calleeName });
    },
  });

  return calls;
}

function getEnclosingTopLevelFunctionName(path) {
  let current = path;
  while (current && current.parentPath) {
    current = current.parentPath;
    if (
      current.isFunctionDeclaration() &&
      current.parentPath &&
      current.parentPath.isProgram()
    ) {
      const id = current.node.id;
      return (id && id.name) || "default";
    }
    if (
      (current.isFunctionExpression() || current.isArrowFunctionExpression()) &&
      current.parentPath
    ) {
      const p = current.parentPath;
      if (p.isVariableDeclarator()) {
        const decl = p;
        const parent = decl.parentPath && decl.parentPath.parentPath;
        if (parent && parent.isProgram()) {
          const id = decl.node.id;
          return (id && id.name) || null;
        }
      }
      if (p.isExportDefaultDeclaration()) {
        const grand = p.parentPath;
        if (grand && grand.isProgram()) {
          return "default";
        }
      }
    }
  }
  return null;
}

function extractExportsAndImportsForFile(rootPath, file, language) {
  const absPath = path.resolve(rootPath, file.path);
  if (!fs.existsSync(absPath)) {
    return { exportNames: new Set(), imports: [] };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { exportNames: new Set(), imports: [] };
  }

  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch (error) {
    return { exportNames: new Set(), imports: [] };
  }

  const isJs = language === "JavaScript" || language === "TypeScript";
  if (!isJs) {
    return { exportNames: new Set(), imports: [] };
  }

  let ast;
  try {
    ast = babelParser.parse(content, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      ranges: true,
      tokens: false,
      plugins: [
        "jsx",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "dynamicImport",
        "exportDefaultFrom",
        "exportNamespaceFrom",
        "topLevelAwait",
        ...(language === "TypeScript" ? ["typescript"] : []),
      ],
    });
  } catch (err) {
    return { exportNames: new Set(), imports: [] };
  }

  const exportNames = new Set();
  const imports = [];

  traverse(ast, {
    ExportDefaultDeclaration(path) {
      exportNames.add("default");
    },
    ExportNamedDeclaration(path) {
      const node = path.node;
      if (node.source) {
        // re-export from another module; skip (we don't attribute to this file)
        return;
      }
      if (node.declaration) {
        const decl = node.declaration;
        if (
          decl.type === "FunctionDeclaration" ||
          decl.type === "ClassDeclaration"
        ) {
          if (decl.id && decl.id.name) exportNames.add(decl.id.name);
        } else if (decl.type === "VariableDeclaration") {
          (decl.declarations || []).forEach((d) => {
            if (d.id && d.id.type === "Identifier") exportNames.add(d.id.name);
          });
        }
      }
      if (Array.isArray(node.specifiers)) {
        node.specifiers.forEach((s) => {
          // export { local as exported }
          const exported = s.exported && s.exported.name;
          if (exported) exportNames.add(exported);
        });
      }
    },
    ImportDeclaration(path) {
      const node = path.node;
      const spec = node.source && node.source.value;
      if (!spec) return;
      const entry = { specifier: spec, names: new Set(), hasNamespace: false };
      (node.specifiers || []).forEach((sp) => {
        if (sp.type === "ImportDefaultSpecifier") {
          entry.names.add("default");
        } else if (sp.type === "ImportSpecifier") {
          const imported =
            sp.imported &&
            (sp.imported.name ||
              (sp.imported.value && String(sp.imported.value)));
          if (imported) entry.names.add(imported);
        } else if (sp.type === "ImportNamespaceSpecifier") {
          entry.hasNamespace = true;
        }
      });
      imports.push(entry);
    },
  });

  return { exportNames, imports };
}

function createFallbackSymbol(content, relativePath, language) {
  if (!content || !content.trim()) {
    return [];
  }

  const normalizedPath = normalizePath(relativePath);
  const snippet = content.slice(0, MAX_SYMBOL_BYTES);
  const lineOffsets = buildLineOffsets(content);
  const totalLines = lineOffsets.length;

  return [
    {
      id: `file:${normalizedPath}#__file__`,
      fileId: `file:${normalizedPath}`,
      name: path.basename(normalizedPath) || normalizedPath,
      kind: "file",
      path: normalizedPath,
      language,
      startLine: 1,
      endLine: totalLines,
      text: snippet,
    },
  ];
}

function dedupeById(entries) {
  const unique = [];
  const indexById = new Map();
  entries.forEach((entry) => {
    if (!entry || !entry.id) {
      return;
    }
    const existingIndex = indexById.get(entry.id);
    if (existingIndex === undefined) {
      indexById.set(entry.id, unique.length);
      unique.push(entry);
      return;
    }
    const existing = unique[existingIndex];
    const existingLength = existing && existing.text ? existing.text.length : 0;
    const candidateLength = entry.text ? entry.text.length : 0;
    if (candidateLength > existingLength) {
      unique[existingIndex] = entry;
    }
  });
  return unique;
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
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const offset = offsets[mid];
    if (position < offset) {
      high = mid - 1;
    } else {
      const next = offsets[mid + 1] || Infinity;
      if (position < next) {
        return mid + 1;
      }
      low = mid + 1;
    }
  }
  return offsets.length;
}

function classifySymbol(name, fallback) {
  if (!name) {
    return fallback;
  }
  if (fallback !== "class" && /^[A-Z]/.test(name)) {
    return "component";
  }
  return fallback;
}

function getGroupFromPath(filePath) {
  const segments = filePath.split("/");
  if (segments.length <= 1) {
    return ".";
  }
  segments.pop();
  return segments.join("/");
}

function getPackageNodeId(filePath) {
  const segments = filePath.split("/");
  if (segments.length < 2) {
    return null;
  }
  const topLevel = segments[0];
  if (!topLevel || topLevel === "." || topLevel.startsWith(".")) {
    return null;
  }
  return `package:${topLevel}`;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

module.exports = {
  buildStructureGraph,
};
