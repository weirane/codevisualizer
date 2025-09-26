import { renderMindMap } from './mindmap.js';
import {
  buildMindMapData,
  renderDiagramStats,
  createGraphLegend,
  appendMeta,
  extractFilePath,
  highlightCodeSnippet,
  escapeHtml
} from './diagramShared.js';

const form = document.querySelector('#diagram-form');
const rootInput = document.querySelector('#diagram-root');
const sidebar = document.querySelector('#diagram-sidebar');
const graphContainer = document.querySelector('#diagram-graph');
const detailPanel = document.querySelector('#diagram-detail');
const detailTitle = detailPanel.querySelector('.diagram-detail__title');
const detailSubtitle = detailPanel.querySelector('.diagram-detail__subtitle');
const detailMeta = detailPanel.querySelector('.diagram-detail__meta');
const detailCode = detailPanel.querySelector('.diagram-detail__code');
const clonesContainer = detailPanel.querySelector('.diagram-detail__clones');

let controller = null;
let lastReport = null;
let diagramData = null;
let selectedNodeId = null;
const snippetCache = new Map();

prefillFromQuery();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const rootPath = rootInput.value.trim();
  if (!rootPath) {
    setDetailMessage('Provide a valid project root to continue.');
    return;
  }
  await runAnalysis(rootPath);
});

async function runAnalysis(rootPath) {
  setLoadingState(true);
  setDetailMessage('Loading analysis…');
  sidebar.innerHTML = '';
  graphContainer.innerHTML = '';
  snippetCache.clear();
  selectedNodeId = null;

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath })
    });

    const report = await response.json();
    if (!response.ok) {
      throw new Error(report.error || 'Failed to analyze project');
    }

    lastReport = report;
    diagramData = buildMindMapData(report);
    updateQuery(rootPath);
    renderSidebar(report, diagramData);
    renderMindMapView(diagramData);
    setDetailMessage('Select a node to view details.');
  } catch (error) {
    console.error('Diagram load failed', error);
    setDetailMessage(error.message || 'Diagram failed to load. Check logs.');
  } finally {
    setLoadingState(false);
  }
}

function renderSidebar(report, data) {
  sidebar.innerHTML = '';
  sidebar.appendChild(renderDiagramStats(report, data));
  sidebar.appendChild(createGraphLegend());
}

function renderMindMapView(data) {
  if (controller && typeof controller.destroy === 'function') {
    controller.destroy();
  }
  selectedNodeId = null;
  controller = renderMindMap(graphContainer, data, {
    onNodeSelect: handleNodeSelect,
    onFindClones: handleFindClones
  });
}

async function handleNodeSelect(node) {
  if (!node) {
    setDetailMessage('Select a node to view details.');
    return;
  }

  try {
    selectedNodeId = node.id || null;
    detailTitle.textContent = node.name || node.path || 'Node';
    detailSubtitle.textContent = node.path || '';
    detailMeta.innerHTML = '';
    appendMeta(detailMeta, 'Type', node.type || 'unknown');
    if (node.description) {
      appendMeta(detailMeta, 'Summary', node.description);
    }

    const filePath = extractFilePath(node);
    if (filePath) {
      appendMeta(detailMeta, 'File', filePath);
    }

    detailCode.classList.add('diagram-detail__code--loading');
    detailCode.textContent = 'Loading…';

    let payload = null;
    if (filePath && lastReport) {
      try {
        payload = await fetchSourceSnippet(lastReport.rootPath, filePath);
        const highlighted = highlightCodeSnippet(payload.content, node);
        detailCode.classList.remove('diagram-detail__code--loading');
        detailCode.innerHTML = `<code>${highlighted}</code>`;
        detailCode.scrollTop = 0;
        if (payload.truncated) {
          appendMeta(detailMeta, 'Note', 'Preview truncated for large file.');
        }
      } catch (error) {
        console.error('Error loading source snippet:', error);
        detailCode.classList.remove('diagram-detail__code--loading');
        detailCode.textContent = error.message || 'Failed to load source.';
      }
    } else {
      detailCode.classList.remove('diagram-detail__code--loading');
      detailCode.textContent = 'No source attached to this node.';
    }

    const clones = (diagramData && diagramData.clones && node.id && diagramData.clones[node.id]) || [];
    await renderClonePreviews(clones);
  } catch (error) {
    console.error('Error in handleNodeSelect:', error);
    setDetailMessage('Error loading node details. Check console for more information.');
  }
}

async function renderClonePreviews(clones) {
  if (!clonesContainer) {
    return;
  }
  clonesContainer.innerHTML = '';

  if (!clones || clones.length === 0) {
    const note = document.createElement('p');
    note.className = 'help-text';
    note.textContent = 'No cloned regions detected for this node.';
    clonesContainer.appendChild(note);
    return;
  }

  const limited = clones.slice(0, 3);
  for (const clone of limited) {
    const card = document.createElement('div');
    card.className = 'clone-card';

    const header = document.createElement('div');
    header.className = 'clone-card__header';

    const location = document.createElement('span');
    location.className = 'clone-card__location';
    location.textContent = `${clone.filePath}:${clone.startLine}-${clone.endLine}`;
    header.appendChild(location);

    const score = document.createElement('span');
    score.className = 'clone-card__score';
    score.textContent = `${Math.round((clone.similarity || 0) * 100)}% match`;
    header.appendChild(score);

    card.appendChild(header);

    const codeBlock = document.createElement('pre');
    codeBlock.className = 'clone-card__code';

    try {
      const payload = await fetchSourceSnippet(lastReport.rootPath, clone.filePath);
      const snippet = extractCloneSnippet(payload.content, clone.startLine, clone.endLine);
      codeBlock.innerHTML = `<code>${escapeHtml(snippet)}</code>`;
      if (payload.truncated) {
        const note = document.createElement('p');
        note.className = 'help-text';
        note.textContent = 'Preview truncated for large file.';
        card.appendChild(note);
      }
    } catch (error) {
      codeBlock.textContent = error.message || 'Failed to load clone preview.';
    }

    card.appendChild(codeBlock);
    clonesContainer.appendChild(card);
  }

  if (clones.length > limited.length) {
    const note = document.createElement('p');
    note.className = 'help-text';
    note.textContent = `Showing ${limited.length} of ${clones.length} clone matches.`;
    clonesContainer.appendChild(note);
  }
}

async function fetchSourceSnippet(rootPath, filePath) {
  const cacheKey = `${rootPath}:${filePath}`;
  if (snippetCache.has(cacheKey)) {
    return snippetCache.get(cacheKey);
  }
  const response = await fetch('/api/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootPath, filePath })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to fetch source snippet');
  }
  snippetCache.set(cacheKey, payload);
  return payload;
}

function extractCloneSnippet(content, startLine, endLine) {
  if (!content) {
    return '';
  }
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, (startLine || 1) - 1);
  const end = Math.min(lines.length, endLine || lines.length);
  return lines.slice(start, end).join('\n');
}

function setDetailMessage(message) {
  detailTitle.textContent = 'Codebase Diagram';
  detailSubtitle.textContent = '';
  detailMeta.innerHTML = '';
  detailCode.classList.remove('diagram-detail__code--loading');
  detailCode.textContent = message;
  if (clonesContainer) {
    clonesContainer.innerHTML = '';
  }
}

function setLoadingState(isLoading) {
  if (isLoading) {
    form.classList.add('is-loading');
  } else {
    form.classList.remove('is-loading');
  }
}

// Overlay UI for clone results
function showCloneOverlay(title, nodes) {
  // Remove existing overlay
  const existing = document.querySelector('.clone-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'clone-overlay';
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(2,6,23,0.7)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';

  const panel = document.createElement('div');
  panel.style.background = '#0b1220';
  panel.style.color = '#e6eef8';
  panel.style.maxWidth = '900px';
  panel.style.width = '90%';
  panel.style.maxHeight = '80%';
  panel.style.overflow = 'auto';
  panel.style.borderRadius = '12px';
  panel.style.padding = '1rem';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const h = document.createElement('h3');
  h.textContent = title;
  header.appendChild(h);

  const close = document.createElement('button');
  close.textContent = 'Close';
  close.className = 'secondary-btn';
  close.addEventListener('click', () => overlay.remove());
  header.appendChild(close);

  panel.appendChild(header);

  if (!nodes || nodes.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No clones found for this file.';
    panel.appendChild(p);
  } else {
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '0.75rem';

    nodes.forEach((c) => {
      const card = document.createElement('div');
      card.style.padding = '0.6rem';
      card.style.background = 'rgba(15,23,42,0.6)';
      card.style.border = '1px solid rgba(148,163,184,0.08)';
      card.style.borderRadius = '8px';

      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.justifyContent = 'space-between';

      const path = document.createElement('div');
      path.textContent = `${c.filePath} (${Math.round((c.similarity||0)*100)}% match)`;
      titleRow.appendChild(path);

      const loc = document.createElement('div');
      loc.textContent = `${c.startLine || '?'}-${c.endLine || '?'}`;
      titleRow.appendChild(loc);

      card.appendChild(titleRow);

      if (c.targetId) {
        const target = document.createElement('div');
        target.className = 'clone-overlay__target';
        target.textContent = describeCloneTarget(c.targetId);
        card.appendChild(target);
      }

      const pre = document.createElement('pre');
      pre.style.maxHeight = '160px';
      pre.style.overflow = 'auto';
      pre.style.marginTop = '0.5rem';
      pre.innerHTML = `<code>${escapeHtml(c.snippet || '')}</code>`;
      card.appendChild(pre);

      list.appendChild(card);
    });
    panel.appendChild(list);
  }

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

async function handleFindClones(node) {
  if (!node || !node.id) return;
  // diagramData.clones maps symbolId -> clones (targets). To find clones for a file,
  // find symbol nodes that belong to this file in diagramData.index, then gather clone entries for those symbols.
  const clonesMap = (diagramData && diagramData.clones) || {};
  const filePath = node.path || null;
  if (!filePath) {
    showCloneOverlay('Clones', []);
    return;
  }

  // obtain node index map (it may already be a Map or a plain object)
  const nodeIndex = diagramData && diagramData.index
    ? (diagramData.index instanceof Map ? diagramData.index : new Map(Object.entries(diagramData.index)))
    : new Map();

  const collected = [];

  nodeIndex.forEach((n, id) => {
    if (!n || !n.path) return;
    if (n.path !== filePath) return; // symbol belongs to selected file
    // for this symbol id, check clone entries
    const list = clonesMap[id] || [];
    (list || []).forEach((entry) => {
      if (!entry || !entry.filePath) return;
      // ignore clones that are within the same file
      if (entry.filePath === filePath) return;
      collected.push(Object.assign({ sourceSymbolId: id }, entry));
    });
  });

  if (collected.length === 0) {
    showCloneOverlay(`Clones for ${filePath}`, []);
    return;
  }

  // Aggregate by target file and pick highest similarity entry as representative
  const byFile = new Map();
  for (const r of collected) {
    const key = r.filePath;
    const exist = byFile.get(key) || { filePath: key, similarity: 0, items: [] };
    exist.similarity = Math.max(exist.similarity, r.similarity || 0);
    exist.items.push(r);
    byFile.set(key, exist);
  }

  const aggregated = [...byFile.values()].sort((a, b) => b.similarity - a.similarity);

  // For each aggregated entry fetch a snippet for preview (use best-match item)
  for (const agg of aggregated) {
    agg.items.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    const best = agg.items[0];
    try {
      const payload = await fetchSourceSnippet(lastReport.rootPath, best.filePath);
      best.snippet = extractCloneSnippet(payload.content, best.startLine, best.endLine);
    } catch (err) {
      best.snippet = `Failed to load snippet: ${err.message}`;
    }
  }

  showCloneOverlay(
    `Clones for ${filePath}`,
    aggregated.map((a) => {
      const best = a.items[0] || {};
      return {
        filePath: a.filePath,
        similarity: a.similarity,
        startLine: best.startLine,
        endLine: best.endLine,
        snippet: best.snippet,
        targetId: best.targetId,
        sourceSymbolId: best.sourceSymbolId
      };
    })
  );
}

function prefillFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const root = params.get('rootPath');
  if (root) {
    rootInput.value = root;
    runAnalysis(root);
  }
}

function updateQuery(rootPath) {
  const url = new URL(window.location.href);
  url.searchParams.set('rootPath', rootPath);
  window.history.replaceState(null, '', url.toString());
}
function describeCloneTarget(targetId) {
  if (!targetId) {
    return '';
  }
  const hashIndex = targetId.indexOf('#');
  const colonIndex = targetId.indexOf(':');
  const symbol = hashIndex !== -1 ? targetId.slice(hashIndex + 1) : targetId;
  const prefix = colonIndex !== -1 ? targetId.slice(0, colonIndex) : '';
  const type = prefix ? prefix.split(':').pop() : '';
  const readableType = type ? `${type} ` : '';
  return `${readableType}${symbol}`;
}
