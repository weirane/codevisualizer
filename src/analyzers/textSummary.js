const { computeDependencyInsights } = require("./dependencyInsights");

function generateTextSummary(report) {
  if (!report || typeof report !== "object") {
    return buildEmptySummary();
  }

  const summary = report.summary || {};
  const totals = summary.totals || {};
  const languages = Array.isArray(summary.languages) ? summary.languages : [];
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const dependencies = report.dependencies || {};
  const dependencyInsights =
    report.dependencyInsights || computeDependencyInsights(dependencies);
  const metricsByFile =
    report.metrics && report.metrics.files ? report.metrics.files : {};
  const clonesMap = report.clones || {};

  const totalFiles = typeof totals.files === "number" ? totals.files : 0;
  const totalDirectories =
    typeof totals.directories === "number" ? totals.directories : 0;
  const walkDurationMs =
    typeof totals.walkDurationMs === "number" ? totals.walkDurationMs : null;
  const traversalTruncated = Boolean(totals.truncated);

  const overviewParts = [];
  if (totalFiles > 0 || totalDirectories > 0) {
    overviewParts.push(
      "Scanned " +
        formatNumber(totalFiles) +
        " file" +
        plural(totalFiles) +
        " across " +
        formatNumber(totalDirectories) +
        " director" +
        (totalDirectories === 1 ? "y" : "ies") +
        "."
    );
  }
  if (languages.length > 0) {
    const dominant = languages[0];
    const share =
      totalFiles > 0 ? Math.round((dominant.files / totalFiles) * 100) : null;
    let dominantText = dominant.language + " dominates the codebase";
    if (share !== null && share > 0) {
      dominantText += " (~" + share + "% of files)";
    }
    dominantText += ".";
    overviewParts.push(dominantText);
  }
  if (walkDurationMs !== null) {
    overviewParts.push(
      "Traversal completed in " + formatDuration(walkDurationMs) + "."
    );
  }
  if (traversalTruncated) {
    overviewParts.push(
      "Traversal limit was reached, so deeper directories may remain unchecked."
    );
  }

  const severityCounts = { error: 0, warning: 0, info: 0 };
  const categoryCounts = {};
  issues.forEach((issue) => {
    const severityKey = issue && issue.severity ? issue.severity : "info";
    if (severityCounts[severityKey] === undefined) {
      severityCounts[severityKey] = 0;
    }
    severityCounts[severityKey] += 1;

    const categoryKey = issue && issue.category ? issue.category : "other";
    if (!categoryCounts[categoryKey]) {
      categoryCounts[categoryKey] = 0;
    }
    categoryCounts[categoryKey] += 1;
  });

  const metricsEntries = Object.keys(metricsByFile).map((filePath) => [
    filePath,
    metricsByFile[filePath],
  ]);

  const complexityHotspots = metricsEntries
    .filter(
      (entry) =>
        entry[1] &&
        typeof entry[1].complexityScore === "number" &&
        entry[1].complexityScore >= 35
    )
    .sort((a, b) => b[1].complexityScore - a[1].complexityScore)
    .slice(0, 3);

  const longFiles = metricsEntries
    .filter(
      (entry) =>
        entry[1] &&
        typeof entry[1].lineCount === "number" &&
        entry[1].lineCount >= 400
    )
    .sort((a, b) => b[1].lineCount - a[1].lineCount)
    .slice(0, 3);

  const heavyFiles = metricsEntries
    .filter(
      (entry) =>
        entry[1] &&
        typeof entry[1].size === "number" &&
        entry[1].size >= 200 * 1024
    )
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3);

  let totalTodoComments = 0;
  metricsEntries.forEach((entry) => {
    const data = entry[1];
    if (data && typeof data.todoCount === "number") {
      totalTodoComments += data.todoCount;
    }
  });

  const unresolvedImports = Array.isArray(dependencies.unresolved)
    ? dependencies.unresolved.length
    : 0;

  const keyFacts = [];
  const languageFacts = languages.slice(0, 3).map((entry) => {
    const percent =
      totalFiles > 0 ? Math.round((entry.files / totalFiles) * 100) : null;
    let descriptor =
      entry.language + " (" + formatNumber(entry.files) + " files";
    if (percent !== null && percent > 0) {
      descriptor += ", ~" + percent + "% of files";
    }
    descriptor += ")";
    return descriptor;
  });
  if (languageFacts.length > 0) {
    keyFacts.push("Language mix: " + formatList(languageFacts) + ".");
  }

  const structureTotals = report.structureGraph && report.structureGraph.totals;
  if (structureTotals) {
    keyFacts.push(
      "Architecture graph covers " +
        formatNumber(structureTotals.packages || 0) +
        " package" +
        plural(structureTotals.packages || 0) +
        ", " +
        formatNumber(structureTotals.files || 0) +
        " file" +
        plural(structureTotals.files || 0) +
        ", and " +
        formatNumber(structureTotals.symbols || 0) +
        " symbol" +
        plural(structureTotals.symbols || 0) +
        "."
    );
  }

  const largestFiles = Array.isArray(summary.largestFiles)
    ? summary.largestFiles.slice(0, 3)
    : [];
  if (largestFiles.length > 0) {
    const largestDescriptions = largestFiles.map(
      (file) => file.path + " (" + formatBytes(file.size) + ")"
    );
    keyFacts.push(
      "Largest files by size: " + formatList(largestDescriptions) + "."
    );
  }

  const warningsTotal =
    (severityCounts.error || 0) + (severityCounts.warning || 0);
  if (warningsTotal > 0) {
    keyFacts.push(
      "Signal mix: " +
        formatNumber(severityCounts.error || 0) +
        " error" +
        plural(severityCounts.error || 0) +
        " and " +
        formatNumber(severityCounts.warning || 0) +
        " warning" +
        plural(severityCounts.warning || 0) +
        " detected."
    );
  } else {
    if ((severityCounts.info || 0) > 0) {
      keyFacts.push(
        "Signals are currently informational only (" +
          formatNumber(severityCounts.info || 0) +
          " items)."
      );
    }
  }

  if (
    dependencyInsights.externalPackages &&
    dependencyInsights.externalPackages.length > 0
  ) {
    const topPackages = dependencyInsights.externalPackages
      .slice(0, 3)
      .map((pkg) => pkg.path + " (" + pkg.count + ")");
    keyFacts.push(
      "Frequently imported external packages: " + formatList(topPackages) + "."
    );
  }

  const hotspots = [];
  if (complexityHotspots.length > 0) {
    const descriptions = complexityHotspots.map(
      (entry) =>
        entry[0] + " (" + entry[1].complexityScore + " decisions/100 lines)"
    );
    hotspots.push(
      "High branching complexity in " + formatList(descriptions) + "."
    );
  }

  if (longFiles.length > 0) {
    const descriptions = longFiles.map(
      (entry) => entry[0] + " (" + formatNumber(entry[1].lineCount) + " lines)"
    );
    hotspots.push("Very long files: " + formatList(descriptions) + ".");
  }

  if (heavyFiles.length > 0) {
    const descriptions = heavyFiles.map(
      (entry) => entry[0] + " (" + formatBytes(entry[1].size) + ")"
    );
    hotspots.push(
      "Large source files that may benefit from modularisation: " +
        formatList(descriptions) +
        "."
    );
  }

  if (dependencyInsights.fanOut && dependencyInsights.fanOut.length > 0) {
    const descriptions = dependencyInsights.fanOut
      .slice(0, 3)
      .map((item) => item.path + " (" + item.count + " outgoing deps)");
    hotspots.push(
      "Modules with high fan-out: " + formatList(descriptions) + "."
    );
  }

  if (dependencyInsights.fanIn && dependencyInsights.fanIn.length > 0) {
    const descriptions = dependencyInsights.fanIn
      .slice(0, 3)
      .map((item) => item.path + " (" + item.count + " inbound deps)");
    hotspots.push(
      "Modules many files rely on: " + formatList(descriptions) + "."
    );
  }

  if (unresolvedImports > 0) {
    hotspots.push(
      formatNumber(unresolvedImports) +
        " unresolved relative import" +
        plural(unresolvedImports) +
        " detected."
    );
  }

  if (totalTodoComments > 0) {
    hotspots.push(
      formatNumber(totalTodoComments) +
        " TODO/FIXME comment" +
        plural(totalTodoComments) +
        " present across the codebase."
    );
  }

  const actions = [];
  if (complexityHotspots.length > 0) {
    actions.push(
      "Refactor complex control flow in " +
        formatList(complexityHotspots.map((entry) => entry[0])) +
        "."
    );
  }

  if (longFiles.length > 0) {
    actions.push(
      "Break down long files such as " +
        formatList(longFiles.map((entry) => entry[0])) +
        " into smaller units."
    );
  }

  if (dependencyInsights.fanOut && dependencyInsights.fanOut.length > 0) {
    const modules = dependencyInsights.fanOut
      .slice(0, 2)
      .map((item) => item.path);
    actions.push(
      "Review dependency boundaries for " +
        formatList(modules) +
        " to prevent excessive coupling."
    );
  }

  if (warningsTotal > 0) {
    const warningPaths = issues
      .filter(
        (issue) =>
          issue && (issue.severity === "warning" || issue.severity === "error")
      )
      .map((issue) => issue.path)
      .filter(Boolean)
      .slice(0, 3);
    if (warningPaths.length > 0) {
      actions.push("Prioritise warnings in " + formatList(warningPaths) + ".");
    }
  }

  if (unresolvedImports > 0) {
    actions.push(
      "Resolve " +
        formatNumber(unresolvedImports) +
        " unresolved import" +
        plural(unresolvedImports) +
        " to stabilise module boundaries."
    );
  }

  if (totalTodoComments > 0) {
    actions.push(
      "Triage " +
        formatNumber(totalTodoComments) +
        " TODO / FIXME comment" +
        plural(totalTodoComments) +
        " to address known design debt."
    );
  }

  if (traversalTruncated) {
    actions.push(
      "Increase traversal depth or raise the entry cap if deeper folders are important."
    );
  }

  // Build detailed clone listing for the narrative
  const clones = [];
  const clonesDetails = [];
  try {
    const symbolArray =
      report.structureGraph && Array.isArray(report.structureGraph.symbols)
        ? report.structureGraph.symbols
        : [];
    const symbolIndex = new Map();
    symbolArray.forEach((s) => {
      if (s && s.id) {
        symbolIndex.set(s.id, s);
      }
    });

    Object.keys(clonesMap).forEach((sourceId) => {
      const entries = Array.isArray(clonesMap[sourceId])
        ? clonesMap[sourceId]
        : [];
      if (entries.length === 0) return;
      const src = symbolIndex.get(sourceId);
      const srcName = src && src.name ? src.name : sourceId;
      const srcPath =
        src && src.path ? src.path : sourceId.split(":")[1] || "unknown";

      entries.forEach((e) => {
        if (!e) return;
        const targetId = e.targetId;
        const tgt = targetId ? symbolIndex.get(targetId) : null;
        const tgtName = tgt && tgt.name ? tgt.name : targetId || "unknown";
        const tgtPath = e.filePath || (tgt && tgt.path) || "unknown";
        const lines =
          Number.isFinite(e.startLine) && Number.isFinite(e.endLine)
            ? e.startLine + "-" + e.endLine
            : null;
        const simPct = Number.isFinite(e.similarity)
          ? Math.round(e.similarity * 100)
          : null;

        let line =
          srcName + " — " + srcPath + " → " + tgtName + " — " + tgtPath;
        if (simPct !== null) {
          line += " (" + simPct + "% similar)";
        }
        if (lines) {
          line += " [" + lines + "]";
        }
        clones.push(line);

        clonesDetails.push({
          similarity: simPct,
          source: {
            id: sourceId,
            name: srcName,
            path: srcPath,
            startLine: Number.isFinite(src && src.startLine)
              ? src.startLine
              : null,
            endLine: Number.isFinite(src && src.endLine) ? src.endLine : null,
          },
          target: {
            id: targetId || null,
            name: tgtName,
            path: tgtPath,
            startLine: Number.isFinite(e.startLine)
              ? e.startLine
              : tgt && Number.isFinite(tgt.startLine)
              ? tgt.startLine
              : null,
            endLine: Number.isFinite(e.endLine)
              ? e.endLine
              : tgt && Number.isFinite(tgt.endLine)
              ? tgt.endLine
              : null,
          },
        });
      });
    });
  } catch (err) {
    // If anything goes wrong, keep narrative robust without clones
  }

  return {
    overview:
      overviewParts.length > 0
        ? overviewParts.join(" ")
        : "No notable architectural facts detected.",
    keyFacts,
    hotspots,
    actions,
    clones,
    clonesDetails,
    metrics: {
      totalFiles,
      totalDirectories,
      traversalMs: walkDurationMs,
      truncated: traversalTruncated,
      severityCounts,
      categoryCounts,
      todoComments: totalTodoComments,
      unresolvedImports,
    },
  };
}

function buildEmptySummary() {
  return {
    overview: "No analysis data available.",
    keyFacts: [],
    hotspots: [],
    actions: [],
    clones: [],
    metrics: {
      totalFiles: 0,
      totalDirectories: 0,
      traversalMs: null,
      truncated: false,
      severityCounts: { error: 0, warning: 0, info: 0 },
      categoryCounts: {},
      todoComments: 0,
      unresolvedImports: 0,
    },
  };
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "0";
  }
  return num.toLocaleString();
}

function formatBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = num;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return value.toFixed(digits) + " " + units[unitIndex];
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "n/a";
  }
  if (ms < 1000) {
    return ms + " ms";
  }
  return (ms / 1000).toFixed(2) + " s";
}

function formatList(items) {
  const filtered = items.filter(Boolean);
  if (filtered.length === 0) {
    return "";
  }
  if (filtered.length === 1) {
    return filtered[0];
  }
  if (filtered.length === 2) {
    return filtered[0] + " and " + filtered[1];
  }
  const head = filtered.slice(0, filtered.length - 1).join(", ");
  return head + ", and " + filtered[filtered.length - 1];
}

function plural(count) {
  return count === 1 ? "" : "s";
}

module.exports = {
  generateTextSummary,
};
