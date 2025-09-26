export function buildMindMapData(report) {
  const rootLabel = deriveProjectLabel(report.rootPath);
  const summaryTotals =
    report.summary && report.summary.totals ? report.summary.totals : {};
  const symbolGroups = groupSymbolsByFile(report.structureGraph);
  const metricsMap = new Map(
    Object.entries((report.metrics && report.metrics.files) || {})
  );
  const issueMap = buildIssueMap(report.issues || []);
  const tree = report.fileTree || {
    type: "directory",
    name: ".",
    path: ".",
    children: [],
  };
  const exportedByFile =
    (report.structureGraph && report.structureGraph.exports) || {};
  const exportUsage =
    (report.structureGraph && report.structureGraph.exportUsage) || {};

  const nodeIndex = new Map();
  const cloneMap = report.clones || {};

  const root = registerNode(
    {
      id: `root:${rootLabel}`,
      name: rootLabel,
      type: "root",
      path: report.rootPath,
      description: buildRootDescription(summaryTotals),
      parentId: null,
      children: [],
    },
    null,
    nodeIndex,
    cloneMap
  );

  const children = (tree.children || [])
    .map((child) => transformNode(child, root.id))
    .filter(Boolean);

  root.children = limitChildren(children, MAX_DIRECTORY_CHILDREN, (remaining) =>
    registerNode(
      {
        id: `summary:${root.id}:${remaining}`,
        name: `+${remaining} more areas`,
        type: "summary",
        path: report.rootPath,
        description: "Additional branches hidden for clarity.",
        children: [],
      },
      root.id,
      nodeIndex,
      cloneMap
    )
  );

  if (!root.children.length) {
    const emptyNode = registerNode(
      {
        id: `summary:${root.id}`,
        name: "No files analyzed",
        type: "summary",
        path: report.rootPath,
        description:
          "Run Analyze on a larger subset of the repo to populate the mind map.",
        children: [],
      },
      root.id,
      nodeIndex,
      cloneMap
    );
    root.children.push(emptyNode);
  }

  const connections = buildMindMapConnections(report.structureGraph, nodeIndex);

  return { root, connections, index: nodeIndex, clones: cloneMap };

  function transformNode(node, parentId) {
    if (!node) {
      return null;
    }

    if (node.type === "directory") {
      const entry = registerNode(
        {
          id: `dir:${node.path}`,
          name: node.path === "." ? rootLabel : node.name,
          type: "directory",
          path: node.path,
          children: [],
        },
        parentId,
        nodeIndex,
        cloneMap
      );

      const resolvedChildren = (node.children || [])
        .map((child) => transformNode(child, entry.id))
        .filter(Boolean);

      entry.children = limitChildren(
        resolvedChildren,
        MAX_DIRECTORY_CHILDREN,
        (remaining) =>
          registerNode(
            {
              id: `summary:${entry.id}:${remaining}`,
              name: `+${remaining} more`,
              type: "summary",
              path: node.path,
              description: "Additional items hidden for readability.",
              children: [],
            },
            entry.id,
            nodeIndex
          )
      );

      if (!entry.children.length) {
        return null;
      }

      // Aggregate export usage signals from descendants to this directory
      const childHasError = resolvedChildren.some(
        (c) => c && (c.allExportsUnused === true || c.hasError === true)
      );
      const childHasWarning = resolvedChildren.some(
        (c) => c && (c.someExportsUnused === true || c.hasWarning === true)
      );
      if (childHasError) {
        entry.allExportsUnused = true; // reuse indicator properties
        entry.hasError = true;
      } else if (childHasWarning) {
        entry.someExportsUnused = true;
        entry.hasWarning = true;
      }

      return entry;
    }

    if (node.type === "file") {
      const normalizedPath = normalizeFilePath(node.path);
      const metrics = metricsMap.get(normalizedPath) || {};
      const fileIssues = issueMap.get(normalizedPath) || [];
      const fileId = `file:${normalizedPath}`;

      const entry = registerNode(
        {
          id: fileId,
          name: node.name,
          type: "file",
          path: normalizedPath,
          description: formatFileDescription(metrics, fileIssues.length),
          children: [],
        },
        parentId,
        nodeIndex,
        cloneMap
      );

      const rawSymbols = symbolGroups.get(normalizedPath) || [];
      const symbolNodes = rawSymbols.map((symbol) =>
        registerNode(
          {
            id: symbol.id || `symbol:${normalizedPath}#${symbol.name}`,
            name: symbol.name,
            type: symbol.kind || "value",
            path: normalizedPath,
            description: formatSymbolDescription(symbol),
            children: [],
          },
          entry.id,
          nodeIndex
        )
      );

      entry.children = limitChildren(
        symbolNodes,
        MAX_SYMBOLS_PER_FILE,
        (remaining) =>
          registerNode(
            {
              id: `summary:${entry.id}:exports:${remaining}`,
              name: `+${remaining} more exports`,
              type: "summary",
              path: normalizedPath,
              description: "This file exports additional symbols.",
              children: [],
            },
            entry.id,
            nodeIndex
          )
      );

      // Compute export usage flags for this file
      const exported = exportedByFile[normalizedPath] || [];
      if (Array.isArray(exported) && exported.length) {
        const unused = exported.filter(
          (name) => (exportUsage[`${normalizedPath}#${name}`] || 0) === 0
        );
        entry.exportsCount = exported.length;
        entry.unusedExportsCount = unused.length;
        if (unused.length === exported.length) {
          entry.allExportsUnused = true;
        } else if (unused.length > 0) {
          entry.someExportsUnused = true;
        }
        if (unused.length) {
          entry.unusedExports = unused.slice(0, 5);
        }
      }

      return entry;
    }

    return null;
  }
}

export function renderDiagramStats(report, mindMapData) {
  const statsContainer = document.createElement("div");
  statsContainer.className = "diagram-sidebar__stats";

  const graphTotals =
    report.structureGraph && report.structureGraph.totals
      ? report.structureGraph.totals
      : {};
  const summaryTotals =
    report.summary && report.summary.totals ? report.summary.totals : {};
  const branchCount =
    mindMapData.root && mindMapData.root.children
      ? mindMapData.root.children.length
      : 0;
  const connectionCount = Array.isArray(mindMapData.connections)
    ? mindMapData.connections.length
    : 0;

  const entries = [
    { label: "Packages", value: formatNumber(graphTotals.packages || 0) },
    { label: "Files (scanned)", value: formatNumber(summaryTotals.files || 0) },
    { label: "Symbols", value: formatNumber(graphTotals.symbols || 0) },
    { label: "Connections", value: formatNumber(connectionCount || 0) },
    { label: "Top-level branches", value: formatNumber(branchCount || 0) },
  ];

  entries.forEach((entry) => {
    const stat = document.createElement("div");
    stat.className = "diagram-sidebar__stat";

    const label = document.createElement("span");
    label.textContent = entry.label;

    const value = document.createElement("strong");
    value.textContent = entry.value;

    stat.append(label, value);
    statsContainer.appendChild(stat);
  });

  return statsContainer;
}

export function createGraphLegend() {
  const legend = document.createElement("div");
  legend.className = "diagram-sidebar__legend";
  const items = [
    { kind: "package", label: "Package / top-level folder", color: "#38bdf8" },
    { kind: "file", label: "File", color: "#6366f1" },
    { kind: "component", label: "React component", color: "#f472b6" },
    { kind: "class", label: "Class", color: "#facc15" },
    { kind: "function", label: "Function", color: "#34d399" },
    { kind: "value", label: "Exported value", color: "#c084fc" },
    { kind: "connection", label: "Import relationship", color: "#5eead4" },
  ];

  items.forEach((item) => {
    const entry = document.createElement("span");
    entry.className = "graph-legend__item";
    const swatch = document.createElement("span");
    swatch.className = "graph-legend__swatch";
    swatch.style.background = item.color;
    entry.appendChild(swatch);
    const label = document.createElement("span");
    label.textContent = item.label;
    entry.appendChild(label);
    legend.appendChild(entry);
  });

  return legend;
}

export function createDetailPanel() {
  const panel = document.createElement("aside");
  panel.className = "diagram-detail";

  const header = document.createElement("div");
  header.className = "diagram-detail__header";
  const title = document.createElement("h3");
  title.className = "diagram-detail__title";
  title.textContent = "Select a node";
  const subtitle = document.createElement("p");
  subtitle.className = "diagram-detail__subtitle";
  subtitle.textContent = "Tap a file or symbol to preview source.";
  header.append(title, subtitle);

  const body = document.createElement("div");
  body.className = "diagram-detail__body";
  const meta = document.createElement("div");
  meta.className = "diagram-detail__meta";
  const code = document.createElement("pre");
  code.className = "diagram-detail__code diagram-detail__code--loading";
  code.textContent = "Waiting for selection…";

  body.append(meta, code);
  panel.append(header, body);

  return panel;
}

export function appendMeta(container, label, value) {
  if (!container) {
    return;
  }
  const item = document.createElement("div");
  item.className = "diagram-detail__meta-item";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  container.appendChild(item);
}

export function extractFilePath(nodeData) {
  if (!nodeData) {
    return null;
  }
  if (
    nodeData.type === "file" ||
    nodeData.type === "component" ||
    nodeData.type === "class" ||
    nodeData.type === "function" ||
    nodeData.type === "value"
  ) {
    return nodeData.path || null;
  }
  if (nodeData.filePath) {
    return nodeData.filePath;
  }
  return null;
}

export function highlightCodeSnippet(content, nodeData) {
  if (!content) {
    return "";
  }
  const escaped = escapeHtml(content);
  if (!nodeData || !nodeData.name) {
    return escaped;
  }
  try {
    // Extract just the symbol name from the full identifier
    const symbolName = nodeData.name.split("#").pop() || nodeData.name;
    const pattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`, "g");
    return escaped.replace(pattern, (match) => `<mark>${match}</mark>`);
  } catch (error) {
    console.warn("Failed to highlight code snippet:", error);
    return escaped;
  }
}

export function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (match) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[match] || match)
  );
}

function buildRootDescription(totals) {
  const parts = [];
  if (totals && totals.files) {
    parts.push(`${formatNumber(totals.files)} files`);
  }
  if (totals && totals.directories) {
    parts.push(`${formatNumber(totals.directories)} directories`);
  }
  if (totals && totals.truncated) {
    parts.push("Partial traversal");
  }
  return parts.join(" • ");
}

function groupSymbolsByFile(structureGraph) {
  const map = new Map();
  if (!structureGraph || !Array.isArray(structureGraph.nodes)) {
    return map;
  }

  structureGraph.nodes.forEach((node) => {
    if (!node || !node.path) {
      return;
    }
    if (node.kind === "file" || node.kind === "package") {
      return;
    }
    const key = normalizeFilePath(node.path);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(node);
  });

  return map;
}

function limitChildren(items, limit, createSummaryNode) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }
  if (!limit || items.length <= limit) {
    return items.slice();
  }
  const visible = items.slice(0, limit);
  const remaining = items.length - limit;
  visible.push(createSummaryNode(remaining));
  return visible;
}

function buildMindMapConnections(structureGraph, nodeIndex) {
  const connections = [];
  if (!structureGraph || !Array.isArray(structureGraph.edges)) {
    return connections;
  }

  const seen = new Set();
  for (const edge of structureGraph.edges) {
    if (!edge || edge.type !== "import") {
      continue;
    }
    const sourceId = edge.source;
    const targetId = edge.target;
    if (!nodeIndex.has(sourceId) || !nodeIndex.has(targetId)) {
      continue;
    }
    const key = `${sourceId}->${targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    connections.push({
      id: key,
      source: sourceId,
      target: targetId,
      type: "import",
    });
    if (connections.length >= MAX_CONNECTIONS) {
      break;
    }
  }
  return connections;
}

function deriveProjectLabel(rootPath) {
  if (!rootPath) {
    return "Project";
  }
  const trimmed = rootPath.replace(/[\/]+$/g, "");
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  if (!parts.length) {
    return trimmed || "Project";
  }
  return parts[parts.length - 1];
}

function formatFileDescription(metrics, issueCount) {
  const parts = [];
  if (metrics && typeof metrics.lineCount === "number") {
    parts.push(`${formatNumber(metrics.lineCount)} lines`);
  }
  if (metrics && typeof metrics.size === "number") {
    parts.push(formatBytes(metrics.size));
  }
  if (
    metrics &&
    typeof metrics.complexityScore === "number" &&
    metrics.complexityScore > 0
  ) {
    parts.push(`complexity ${metrics.complexityScore}`);
  }
  if (issueCount) {
    parts.push(`${issueCount} issue${issueCount === 1 ? "" : "s"}`);
  }
  return parts.join(" • ");
}

function formatSymbolDescription(symbol) {
  if (!symbol) {
    return "";
  }
  const parts = [];
  if (symbol.kind) {
    parts.push(symbol.kind);
  }
  if (symbol.language) {
    parts.push(symbol.language);
  }
  if (symbol.metrics && typeof symbol.metrics.lineCount === "number") {
    parts.push(`${formatNumber(symbol.metrics.lineCount)} lines`);
  }
  return parts.join(" • ");
}

function normalizeFilePath(value) {
  if (!value) {
    return value;
  }
  return value.replace(/\\\\/g, "/");
}

function typeRank(type) {
  switch (type) {
    case "root":
      return -1;
    case "directory":
      return 0;
    case "file":
      return 1;
    case "component":
      return 2;
    case "class":
      return 3;
    case "function":
      return 4;
    case "value":
      return 5;
    case "summary":
      return 6;
    default:
      return 7;
  }
}

function registerNode(node, parentId, index, cloneMap) {
  if (!node.id) {
    node.id = `node:${Math.random().toString(36).slice(2, 10)}`;
  }
  node.parentId = parentId;
  if (!node.children) {
    node.children = [];
  }
  // cloneMap may be omitted in some call sites; guard access to avoid runtime errors
  if (cloneMap && cloneMap[node.id]) {
    node.hasClones = true;
  }
  index.set(node.id, node);
  return node;
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
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function buildIssueMap(issues) {
  const map = new Map();
  (issues || []).forEach((issue) => {
    if (!issue.path) {
      return;
    }
    if (!map.has(issue.path)) {
      map.set(issue.path, []);
    }
    map.get(issue.path).push(issue);
  });
  return map;
}

const MAX_DIRECTORY_CHILDREN = 24;
const MAX_SYMBOLS_PER_FILE = 10;
const MAX_CONNECTIONS = 400;
