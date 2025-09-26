const form = document.querySelector("#analyze-form");
const rootPathInput = document.querySelector("#rootPath");
const resultsEl = document.querySelector("#results");
const summaryButton = document.querySelector("#summary-button");
let lastReport = null;
let narrativeSectionEl = null;

if (summaryButton) {
  summaryButton.disabled = true;
  summaryButton.addEventListener("click", handleSummaryClick);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rootPath = rootPathInput.value.trim();

  if (!rootPath) {
    renderError("Please provide a valid root directory.");
    return;
  }

  resetNarrativeSection();
  lastReport = null;
  if (summaryButton) {
    summaryButton.disabled = true;
  }

  renderLoading(`Analyzing ${rootPath} ...`);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath }),
    });

    const payload = await response.json();

    if (!response.ok) {
      renderError(payload.error || "Unknown server error");
      return;
    }

    renderReport(payload);
  } catch (error) {
    console.error("Request failed", error);
    renderError("Could not reach the analysis server. Check logs.");
  }
});

function renderLoading(message) {
  if (summaryButton) {
    summaryButton.disabled = true;
  }
  resultsEl.classList.remove("ready");
  resultsEl.innerHTML = `<p class="status loading">${escapeHtml(message)}</p>`;
}

function renderError(message) {
  if (summaryButton) {
    summaryButton.disabled = !lastReport;
  }
  resultsEl.classList.remove("ready");
  resultsEl.innerHTML = `<p class="status error">${escapeHtml(message)}</p>`;
}

function renderReport(report) {
  lastReport = report;
  resetNarrativeSection();
  if (summaryButton) {
    summaryButton.disabled = false;
  }
  resultsEl.classList.add("ready");
  resultsEl.innerHTML = "";

  const metricsMap = new Map(
    Object.entries((report.metrics && report.metrics.files) || {})
  );
  const issueMap = buildIssueMap(report.issues || []);
  computeDirectorySummaries(report.fileTree, issueMap);

  resultsEl.appendChild(renderAnalysisMeta(report));
  const summarySection = renderSummarySection(report.summary);
  resultsEl.appendChild(summarySection);

  narrativeSectionEl = renderNarrativePlaceholder();
  resultsEl.appendChild(narrativeSectionEl);

  const languagesSection = renderLanguageSection(report.summary.languages);
  if (languagesSection) {
    resultsEl.appendChild(languagesSection);
  }

  const issuesSection = renderIssuesSection(report.issues || []);
  if (issuesSection) {
    resultsEl.appendChild(issuesSection);
  }

  resultsEl.appendChild(
    renderFileTreeSection(report.fileTree, metricsMap, issueMap)
  );

  const dependencySection = renderDependencySection(
    report.dependencies,
    report.dependencyInsights
  );
  if (dependencySection) {
    resultsEl.appendChild(dependencySection);
  }
}

function handleSummaryClick() {
  const requestedPath = rootPathInput.value.trim();

  if (!lastReport) {
    setNarrativeMessage(
      "Run Analyze to produce an architecture summary first."
    );
    return;
  }

  if (requestedPath && requestedPath !== lastReport.rootPath) {
    setNarrativeMessage(
      "The current input differs from the last analyzed path. Run Analyze to refresh results."
    );
    return;
  }

  if (!lastReport.narrative) {
    setNarrativeMessage(
      "Summary data was not included in the latest analysis."
    );
    return;
  }

  displayNarrative(lastReport.narrative);
}

function renderAnalysisMeta(report) {
  const meta = document.createElement("div");
  meta.className = "analysis-meta";

  meta.appendChild(createMetaItem("Root", report.rootPath, true));
  meta.appendChild(createMetaItem("Generated", formatDate(report.generatedAt)));
  meta.appendChild(
    createMetaItem(
      "Traversal Time",
      formatDuration(
        report.summary && report.summary.totals
          ? report.summary.totals.walkDurationMs
          : undefined
      )
    )
  );
  meta.appendChild(
    createMetaItem(
      "Files Scanned",
      formatNumber(
        report.summary && report.summary.totals
          ? report.summary.totals.files
          : 0
      )
    )
  );

  return meta;
}

function createMetaItem(label, value, useCode = false) {
  const item = document.createElement("div");
  item.className = "analysis-meta__item";

  const labelEl = document.createElement("span");
  labelEl.className = "analysis-meta__label";
  labelEl.textContent = label;

  let valueEl;
  if (useCode) {
    valueEl = document.createElement("code");
    valueEl.textContent = value;
  } else {
    valueEl = document.createElement("span");
    valueEl.textContent = value;
  }

  item.appendChild(labelEl);
  item.appendChild(valueEl);
  return item;
}

function renderSummarySection(summary) {
  const section = createSection("Snapshot");
  const grid = document.createElement("div");
  grid.className = "summary-grid";

  const cards = [
    { label: "Directories", value: formatNumber(summary.totals.directories) },
    { label: "Files", value: formatNumber(summary.totals.files) },
    {
      label: "Traversal Time",
      value: formatDuration(summary.totals.walkDurationMs),
    },
    {
      label: "Traversal Limit",
      value: summary.totals.truncated ? "Reached" : "Complete",
    },
  ];

  if (summary.warningsCount) {
    cards.push({
      label: "Filesystem Warnings",
      value: formatNumber(summary.warningsCount),
    });
  }

  for (const card of cards) {
    grid.appendChild(createSummaryCard(card.label, card.value));
  }

  section.appendChild(grid);
  section.appendChild(
    createDividerText(
      "Largest Files",
      createTopList(summary.largestFiles, formatFileSizeEntry)
    )
  );
  section.appendChild(
    createDividerText(
      "Longest Files",
      createTopList(summary.longestFiles, formatLineCountEntry)
    )
  );

  return section;
}

function createSummaryCard(label, value) {
  const card = document.createElement("div");
  card.className = "summary-card";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.style.fontSize = "1.4rem";
  valueEl.style.fontWeight = "700";
  valueEl.textContent = value;

  card.appendChild(labelEl);
  card.appendChild(valueEl);
  return card;
}

function createDividerText(title, contentEl) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "0.5rem";
  container.style.marginTop = "1rem";

  const label = document.createElement("span");
  label.style.fontSize = "0.8rem";
  label.style.letterSpacing = "0.08em";
  label.style.textTransform = "uppercase";
  label.style.color = "rgba(148, 163, 184, 0.75)";
  label.textContent = title;

  container.appendChild(label);
  if (contentEl) {
    container.appendChild(contentEl);
  } else {
    container.appendChild(createEmptyState("No data available."));
  }

  return container;
}

function renderNarrativePlaceholder() {
  const section = createSection("Narrative Summary");
  const message = createNarrativeMessage(
    'Use "Generate Summary" to produce a written overview based on the latest analysis.'
  );
  section.appendChild(message);
  return section;
}

function ensureNarrativeSection() {
  if (narrativeSectionEl && narrativeSectionEl.parentNode) {
    return narrativeSectionEl;
  }
  narrativeSectionEl = renderNarrativePlaceholder();
  resultsEl.appendChild(narrativeSectionEl);
  return narrativeSectionEl;
}

function resetNarrativeSection() {
  if (narrativeSectionEl && narrativeSectionEl.parentNode) {
    narrativeSectionEl.parentNode.removeChild(narrativeSectionEl);
  }
  narrativeSectionEl = null;
}

function setNarrativeMessage(message) {
  const section = ensureNarrativeSection();
  replaceSectionContent(section, [createNarrativeMessage(message)]);
}

function displayNarrative(summary) {
  const section = ensureNarrativeSection();
  const nodes = buildNarrativeNodes(summary);
  if (nodes.length === 0) {
    replaceSectionContent(section, [
      createNarrativeMessage(
        "No narrative summary available for this analysis."
      ),
    ]);
    return;
  }
  replaceSectionContent(section, nodes);
}

function buildNarrativeNodes(summary) {
  const nodes = [];
  if (!summary || typeof summary !== "object") {
    return nodes;
  }

  if (summary.overview) {
    const overview = document.createElement("p");
    overview.className = "narrative-overview";
    overview.textContent = summary.overview;
    nodes.push(overview);
  }

  const keyFactsBlock = createNarrativeBlock("Key Facts", summary.keyFacts);
  if (keyFactsBlock) {
    nodes.push(keyFactsBlock);
  }

  const hotspotsBlock = createNarrativeBlock(
    "Hotspots to Inspect",
    summary.hotspots
  );
  if (hotspotsBlock) {
    nodes.push(hotspotsBlock);
  }

  const actionsBlock = createNarrativeBlock(
    "Suggested Actions",
    summary.actions
  );
  if (actionsBlock) {
    nodes.push(actionsBlock);
  }

  const clonesBlock = createNarrativeBlock(
    "Detected Code Clones",
    summary.clones
  );
  if (clonesBlock) {
    nodes.push(clonesBlock);
  }

  return nodes;
}

function createNarrativeBlock(title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const block = document.createElement("div");
  block.className = "narrative-block";

  const heading = document.createElement("h4");
  heading.textContent = title;
  block.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "narrative-list";
  items.slice(0, 12).forEach((item, index) => {
    const value = typeof item === "string" ? item : String(item);
    const li = document.createElement("li");
    li.textContent = value;

    // If this block is the clones list, attach click to open side-by-side view
    if (
      title === "Detected Code Clones" &&
      lastReport &&
      lastReport.narrative &&
      Array.isArray(lastReport.narrative.clonesDetails)
    ) {
      const details = lastReport.narrative.clonesDetails[index];
      if (details) {
        li.style.cursor = "pointer";
        li.addEventListener("click", () => openCloneDiffOverlay(details));
      }
    }

    list.appendChild(li);
  });
  block.appendChild(list);
  return block;
}

function createNarrativeMessage(message) {
  const note = document.createElement("p");
  note.className = "narrative-message";
  note.textContent = message;
  return note;
}

function replaceSectionContent(section, nodes) {
  while (section.children.length > 1) {
    section.removeChild(section.lastChild);
  }
  nodes.forEach((node) => {
    section.appendChild(node);
  });
}

function createTopList(items, formatter) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const list = document.createElement("ol");
  list.style.margin = "0";
  list.style.paddingLeft = "1.4rem";
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "0.35rem";
  items.slice(0, 5).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = formatter(item);
    list.appendChild(li);
  });
  return list;
}

function formatFileSizeEntry(item) {
  return `${item.path} (${formatBytes(item.size)})`;
}

function formatLineCountEntry(item) {
  return `${item.path} (${formatNumber(item.lineCount)} lines)`;
}

function createEmptyState(message) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = message;
  return div;
}

async function openCloneDiffOverlay(details) {
  try {
    const rootPath = (lastReport && lastReport.rootPath) || "";
    const sourcePath = details && details.source && details.source.path;
    const targetPath = details && details.target && details.target.path;
    if (!rootPath || !sourcePath || !targetPath) return;

    // Resolve full function ranges from structureGraph symbols (prefer complete function over overlap slice)
    const symbolArray =
      (lastReport &&
        lastReport.structureGraph &&
        lastReport.structureGraph.symbols) ||
      [];
    const symIndex = new Map();
    (symbolArray || []).forEach((s) => {
      if (s && s.id) symIndex.set(s.id, s);
    });
    const srcSym =
      details && details.source && details.source.id
        ? symIndex.get(details.source.id)
        : null;
    const tgtSym =
      details && details.target && details.target.id
        ? symIndex.get(details.target.id)
        : null;

    const srcStart =
      srcSym && Number.isFinite(srcSym.startLine)
        ? srcSym.startLine
        : (details.source && details.source.startLine) || null;
    const srcEnd =
      srcSym && Number.isFinite(srcSym.endLine)
        ? srcSym.endLine
        : (details.source && details.source.endLine) || null;
    const tgtStart =
      tgtSym && Number.isFinite(tgtSym.startLine)
        ? tgtSym.startLine
        : (details.target && details.target.startLine) || null;
    const tgtEnd =
      tgtSym && Number.isFinite(tgtSym.endLine)
        ? tgtSym.endLine
        : (details.target && details.target.endLine) || null;

    const [srcRes, tgtRes] = await Promise.all([
      fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath, filePath: sourcePath }),
      }).then((r) => r.json()),
      fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath, filePath: targetPath }),
      }).then((r) => r.json()),
    ]);

    showSideBySideOverlay({
      title: "Code Clone Preview",
      similarity: details.similarity,
      source: {
        path: sourcePath,
        content: (srcRes && srcRes.content) || "",
        startLine: srcStart,
        endLine: srcEnd,
      },
      target: {
        path: targetPath,
        content: (tgtRes && tgtRes.content) || "",
        startLine: tgtStart,
        endLine: tgtEnd,
      },
    });
  } catch (err) {
    console.error("Failed to open clone overlay", err);
  }
}

function showSideBySideOverlay(payload) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.backdropFilter = "blur(2px)";
  overlay.style.zIndex = "9999";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });

  const panel = document.createElement("div");
  panel.style.position = "absolute";
  panel.style.top = "5%";
  panel.style.left = "50%";
  panel.style.transform = "translateX(-50%)";
  panel.style.width = "92%";
  panel.style.height = "90%";
  panel.style.background = "white";
  panel.style.borderRadius = "10px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.padding = "0.75rem 1rem";
  header.style.borderBottom = "1px solid #e5e7eb";

  const title = document.createElement("div");
  title.textContent = `${payload.title} ${
    payload.similarity != null ? "(" + payload.similarity + "%)" : ""
  }`;
  title.style.fontWeight = "600";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => document.body.removeChild(overlay));
  header.appendChild(closeBtn);

  const content = document.createElement("div");
  content.style.display = "grid";
  content.style.gridTemplateColumns = "1fr 1fr";
  content.style.gap = "0";
  content.style.flex = "1 1 auto";
  content.style.minHeight = "0";

  const left = buildCodePane(payload.source);
  const right = buildCodePane(payload.target);

  content.appendChild(left);
  content.appendChild(right);

  panel.appendChild(header);
  panel.appendChild(content);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function buildCodePane(file) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.minWidth = "0";
  wrap.style.minHeight = "0";

  const bar = document.createElement("div");
  bar.style.display = "flex";
  bar.style.alignItems = "center";
  bar.style.justifyContent = "space-between";
  bar.style.gap = "0.5rem";
  bar.style.padding = "0.5rem 0.75rem";
  bar.style.borderBottom = "1px solid #e5e7eb";

  const label = document.createElement("div");
  label.textContent = file.path;
  label.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
  label.style.fontSize = "0.85rem";
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  bar.appendChild(label);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(file.content || "");
    } catch {}
  });
  bar.appendChild(copyBtn);

  const pre = document.createElement("pre");
  pre.style.margin = "0";
  pre.style.padding = "0.75rem";
  pre.style.fontSize = "12px";
  pre.style.overflow = "auto";
  pre.style.flex = "1 1 auto";
  pre.style.background = "#0b1021";
  pre.style.color = "#e5e7eb";
  pre.style.lineHeight = "1.4";
  pre.style.tabSize = "2";
  pre.style.counterReset = "line";

  const code = document.createElement("code");
  code.style.whiteSpace = "pre";
  code.style.display = "block";

  // Build content with simple line numbers and highlight range if provided
  const lines = String(file.content || "").split("\n");
  const startHL = Number.isFinite(file.startLine) ? file.startLine : null;
  const endHL = Number.isFinite(file.endLine) ? file.endLine : null;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i += 1) {
    const ln = i + 1;
    const line = document.createElement("div");
    line.style.display = "grid";
    line.style.gridTemplateColumns = "3ch auto";
    line.style.gap = "1ch";
    line.style.padding = "0 0.25rem";
    if (startHL !== null && endHL !== null && ln >= startHL && ln <= endHL) {
      line.style.background = "rgba(34,197,94,0.15)";
    }

    const gutter = document.createElement("span");
    gutter.textContent = String(ln);
    gutter.style.color = "rgba(148,163,184,0.5)";
    gutter.style.textAlign = "right";

    const text = document.createElement("span");
    text.textContent = lines[i];
    text.style.whiteSpace = "pre";

    line.appendChild(gutter);
    line.appendChild(text);
    frag.appendChild(line);
  }
  code.appendChild(frag);
  pre.appendChild(code);

  wrap.appendChild(bar);
  wrap.appendChild(pre);
  return wrap;
}

function createSection(title) {
  const section = document.createElement("section");
  section.className = "results__section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function buildIssueMap(issues) {
  const map = new Map();
  issues.forEach((issue) => {
    if (!issue.path) return;
    if (!map.has(issue.path)) {
      map.set(issue.path, []);
    }
    map.get(issue.path).push(issue);
  });
  return map;
}

function computeDirectorySummaries(node, issueMap) {
  if (!node || !Array.isArray(node.children)) {
    node.__summary = { fileCount: 0, issueCount: 0 };
    return node.__summary;
  }

  let fileCount = 0;
  let issueCount = 0;

  node.children.forEach((child) => {
    if (child.type === "directory") {
      const summary = computeDirectorySummaries(child, issueMap);
      fileCount += summary.fileCount;
      issueCount += summary.issueCount;
    } else {
      fileCount += 1;
      const childIssues = issueMap.get(child.path) || [];
      issueCount += childIssues.filter(
        (issue) => issue.severity === "warning" || issue.severity === "error"
      ).length;
    }
  });

  node.__summary = { fileCount, issueCount };
  return node.__summary;
}

function compareSeverity(a, b) {
  return severityRank(a.severity) - severityRank(b.severity);
}

function severityRank(value) {
  switch (value) {
    case "error":
      return 0;
    case "warning":
      return 1;
    default:
      return 2;
  }
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toLocaleString() : "0";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let count = bytes;
  let index = 0;
  while (count >= 1024 && index < units.length - 1) {
    count /= 1024;
    index += 1;
  }
  return `${count.toFixed(count >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch (error) {
    return value;
  }
}

function escapeHtml(value) {
  const str = String(value);
  return str.replace(
    /[&<>"]+/g,
    (match) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[match] || match)
  );
}

function renderLanguageSection(languages) {
  if (!Array.isArray(languages) || languages.length === 0) {
    return null;
  }

  const section = createSection("Languages");
  const grid = document.createElement("div");
  grid.className = "languages-grid";

  languages.forEach((lang) => {
    const card = document.createElement("div");
    card.className = "language-card";

    const name = document.createElement("h4");
    name.textContent = lang.language || "Unknown";
    card.appendChild(name);

    const stats = document.createElement("div");
    stats.className = "language-stats";

    const files = document.createElement("div");
    files.textContent = `${formatNumber(lang.files)} files`;
    stats.appendChild(files);

    const lines = document.createElement("div");
    lines.textContent = `${formatNumber(lang.lines)} lines`;
    stats.appendChild(lines);

    const size = document.createElement("div");
    size.textContent = formatBytes(lang.bytes);
    stats.appendChild(size);

    card.appendChild(stats);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}

function renderIssuesSection(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return null;
  }

  const section = createSection("Issues");
  const issuesList = document.createElement("div");
  issuesList.className = "issues-list";

  issues.forEach((issue) => {
    const categoryClass = issue.category
      ? ` issue-item--category-${issue.category}`
      : "";
    const item = document.createElement("div");
    item.className = `issue-item issue-item--${
      issue.severity || "info"
    }${categoryClass}`;

    const header = document.createElement("div");
    header.className = "issue-header";

    const severity = document.createElement("span");
    severity.className = "issue-severity";
    severity.textContent = issue.severity || "info";
    header.appendChild(severity);

    const category = document.createElement("span");
    category.className = `issue-category issue-category--${
      issue.category || "unknown"
    }`;
    category.textContent = issue.category || "unknown";
    header.appendChild(category);

    item.appendChild(header);

    const path = document.createElement("div");
    path.className = "issue-path";
    path.textContent = issue.path || "Unknown path";
    item.appendChild(path);

    const message = document.createElement("div");
    message.className = "issue-message";
    message.textContent = issue.message || "No message";
    item.appendChild(message);

    issuesList.appendChild(item);
  });

  section.appendChild(issuesList);
  return section;
}

function renderFileTreeSection(fileTree, metricsMap, issueMap) {
  const section = createSection("File Structure");
  const treeContainer = document.createElement("div");
  treeContainer.className = "file-tree";

  if (!fileTree || !fileTree.children) {
    treeContainer.textContent = "No file structure available";
    section.appendChild(treeContainer);
    return section;
  }

  const treeElement = renderFileTreeNode(fileTree, metricsMap, issueMap, 0);
  treeContainer.appendChild(treeElement);
  section.appendChild(treeContainer);
  return section;
}

function renderFileTreeNode(node, metricsMap, issueMap, depth) {
  const container = document.createElement("div");
  container.className = "file-tree-node";
  container.style.paddingLeft = `${depth * 20}px`;

  const nodeElement = document.createElement("div");
  nodeElement.className = `file-tree-item file-tree-item--${node.type}`;

  const name = document.createElement("span");
  name.className = "file-tree-name";
  name.textContent = node.name || "Unknown";
  nodeElement.appendChild(name);

  if (node.type === "file") {
    const metrics = metricsMap.get(node.path) || {};
    const issues = issueMap.get(node.path) || [];

    const details = document.createElement("span");
    details.className = "file-tree-details";

    const parts = [];
    if (metrics.lineCount) {
      parts.push(`${formatNumber(metrics.lineCount)} lines`);
    }
    if (metrics.size) {
      parts.push(formatBytes(metrics.size));
    }
    if (issues.length > 0) {
      parts.push(`${issues.length} issue${issues.length === 1 ? "" : "s"}`);
    }

    details.textContent = parts.join(" • ");
    nodeElement.appendChild(details);
  } else if (node.__summary) {
    const summary = document.createElement("span");
    summary.className = "file-tree-summary";
    summary.textContent = `${formatNumber(
      node.__summary.fileCount
    )} files, ${formatNumber(node.__summary.issueCount)} issues`;
    nodeElement.appendChild(summary);
  }

  container.appendChild(nodeElement);

  if (node.children && node.children.length > 0) {
    node.children.forEach((child) => {
      const childElement = renderFileTreeNode(
        child,
        metricsMap,
        issueMap,
        depth + 1
      );
      container.appendChild(childElement);
    });
  }

  return container;
}

function renderDependencySection(dependencies, dependencyInsights) {
  if (
    !dependencies ||
    !Array.isArray(dependencies.resolved) ||
    dependencies.resolved.length === 0
  ) {
    return null;
  }

  const section = createSection("Dependencies");

  const resolvedSection = document.createElement("div");
  resolvedSection.className = "dependency-section";

  const resolvedTitle = document.createElement("h4");
  resolvedTitle.textContent = "Resolved Dependencies";
  resolvedSection.appendChild(resolvedTitle);

  const resolvedList = document.createElement("ul");
  resolvedList.className = "dependency-list";

  dependencies.resolved.forEach((dep) => {
    const item = document.createElement("li");
    item.className = "dependency-item";

    const name = document.createElement("span");
    name.textContent = dep.specifier || "Unknown";
    item.appendChild(name);

    if (dep.source) {
      const source = document.createElement("span");
      source.className = "dependency-source";
      source.textContent = ` (from ${dep.source})`;
      item.appendChild(source);
    }

    resolvedList.appendChild(item);
  });

  resolvedSection.appendChild(resolvedList);
  section.appendChild(resolvedSection);

  if (dependencies.unresolved && dependencies.unresolved.length > 0) {
    const unresolvedSection = document.createElement("div");
    unresolvedSection.className = "dependency-section";

    const unresolvedTitle = document.createElement("h4");
    unresolvedTitle.textContent = "Unresolved Dependencies";
    unresolvedSection.appendChild(unresolvedTitle);

    const unresolvedList = document.createElement("ul");
    unresolvedList.className = "dependency-list dependency-list--unresolved";

    dependencies.unresolved.forEach((dep) => {
      const item = document.createElement("li");
      item.className = "dependency-item dependency-item--unresolved";

      const name = document.createElement("span");
      name.textContent = dep.specifier || "Unknown";
      item.appendChild(name);

      if (dep.source) {
        const source = document.createElement("span");
        source.className = "dependency-source";
        source.textContent = ` (from ${dep.source})`;
        item.appendChild(source);
      }

      unresolvedList.appendChild(item);
    });

    unresolvedSection.appendChild(unresolvedList);
    section.appendChild(unresolvedSection);
  }

  return section;
}
