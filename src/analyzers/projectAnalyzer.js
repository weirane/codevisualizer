const path = require("path");
const { collectEntries } = require("../utils/fileSystem");
const { buildFileTree } = require("./fileTree");
const { computeFileMetrics } = require("./fileMetrics");
const { buildDependencyGraph } = require("./dependencyGraph");
const { detectLanguage } = require("./language");
const { computeDependencyInsights } = require("./dependencyInsights");
const { buildStructureGraph } = require("./structureGraph");
const { findSymbolClones } = require("./cloneDetector");
const { detectCodeSmells } = require("./smellDetector");

async function analyzeProject(rootPath) {
  const absRoot = path.resolve(rootPath);
  const walkStart = Date.now();
  const { files, directories, warnings, truncated } = collectEntries(absRoot);
  const walkDurationMs = Date.now() - walkStart;

  const fileTree = buildFileTree(files, directories);
  const { metricsByFile, issues: metricIssues } = computeFileMetrics(
    absRoot,
    files
  );
  const dependencies = buildDependencyGraph(absRoot, files);
  const dependencyInsights = computeDependencyInsights(dependencies);
  const structureGraph = buildStructureGraph(
    absRoot,
    files,
    metricsByFile,
    dependencies
  );
  const clones = findSymbolClones(absRoot, structureGraph.symbols || []);
  const smellIssues = detectCodeSmells(structureGraph);
  if (structureGraph.symbols) {
    structureGraph.symbols = structureGraph.symbols.map((entry) => {
      const { text, ...rest } = entry;
      return rest;
    });
  }

  const summary = buildSummary({
    files,
    directories,
    metricsByFile,
    warnings,
    truncated,
    walkDurationMs,
  });
  const issues = mergeIssues({
    metricIssues,
    warnings,
    dependencies,
    smellIssues,
  });

  return {
    rootPath: absRoot,
    generatedAt: new Date().toISOString(),
    summary,
    fileTree,
    dependencies,
    dependencyInsights,
    structureGraph,
    clones,
    metrics: {
      files: Object.fromEntries(metricsByFile),
    },
    issues,
  };
}

function buildSummary({
  files,
  directories,
  metricsByFile,
  warnings,
  truncated,
  walkDurationMs,
}) {
  const languageBreakdown = aggregateLanguages(files, metricsByFile);
  const largestFiles = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 8)
    .map((file) => ({
      path: file.path,
      size: file.size,
      language: detectLanguage(file.ext),
    }));

  const longestFiles = [...metricsByFile.entries()]
    .filter(([, metrics]) => metrics.lineCount)
    .sort((a, b) => b[1].lineCount - a[1].lineCount)
    .slice(0, 8)
    .map(([path, metrics]) => ({ path, lineCount: metrics.lineCount }));

  return {
    totals: {
      directories: directories.length,
      files: files.length,
      truncated,
      walkDurationMs,
    },
    languages: languageBreakdown,
    largestFiles,
    longestFiles,
    warningsCount: warnings.length,
  };
}

function aggregateLanguages(files, metricsByFile) {
  const counts = new Map();
  for (const file of files) {
    const language = detectLanguage(file.ext);
    if (!counts.has(language)) {
      counts.set(language, { language, files: 0, lines: 0, bytes: 0 });
    }
    const entry = counts.get(language);
    entry.files += 1;
    entry.bytes += file.size;
    const metrics = metricsByFile.get(file.path);
    if (metrics && metrics.lineCount) {
      entry.lines += metrics.lineCount;
    }
  }
  return [...counts.values()].sort((a, b) => b.files - a.files);
}

function mergeIssues({ metricIssues, warnings, dependencies, smellIssues }) {
  const issues = [];
  issues.push(
    ...metricIssues.map((issue) => ({
      category: "metric",
      severity: issue.severity,
      path: issue.path,
      message: issue.message,
    }))
  );

  issues.push(
    ...warnings.map((warning) => ({
      category: "filesystem",
      severity: warning.type === "limit-reached" ? "warning" : "info",
      path: warning.path,
      message: describeWarning(warning),
    }))
  );

  issues.push(
    ...dependencies.unresolved.map((item) => ({
      category: "dependency",
      severity: "info",
      path: item.source,
      message: item.specifier
        ? `Unresolved import "${item.specifier}"`
        : item.reason,
    }))
  );

  if (Array.isArray(smellIssues) && smellIssues.length) {
    issues.push(...smellIssues);
  }

  return issues;
}

function describeWarning(warning) {
  if (warning.type === "limit-reached") {
    return `Traversal limit reached while inspecting ${warning.path}. Results may be partial.`;
  }
  if (warning.type === "read-error") {
    return `Could not read directory ${warning.path}: ${warning.error}`;
  }
  if (warning.type === "stat-error") {
    return `Could not stat ${warning.path}.`;
  }
  return warning.type;
}

module.exports = {
  analyzeProject,
};
