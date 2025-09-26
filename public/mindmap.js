export function renderMindMap(container, data, options = {}) {
  if (!container) {
    return noopController();
  }

  container.innerHTML = "";

  const root = data && data.root;
  const nodeIndex = normaliseIndex(data && data.index);
  const cloneMap = (data && data.clones) || {};
  const onNodeSelect =
    typeof options.onNodeSelect === "function"
      ? options.onNodeSelect
      : () => {};

  if (!root || !Array.isArray(root.children)) {
    container.textContent = "No architecture data available yet.";
    return noopController();
  }

  const timeline = document.createElement("div");
  timeline.className = "mindmap-timeline";
  const columnsWrap = document.createElement("div");
  columnsWrap.className = "mindmap-columns";
  timeline.appendChild(columnsWrap);
  container.appendChild(timeline);

  let activePath = [];
  let selectedId = null;

  const rootChildren = (root.children || []).slice();

  function render() {
    columnsWrap.innerHTML = "";

    const topColumn = buildColumn(
      { id: root.id, name: root.name, type: root.type },
      rootChildren,
      0,
      activePath[0]
    );
    columnsWrap.appendChild(topColumn);

    activePath.forEach((nodeId, depth) => {
      const current = nodeIndex.get(nodeId);
      if (
        !current ||
        !Array.isArray(current.children) ||
        current.children.length === 0
      ) {
        return;
      }
      const column = buildColumn(
        current,
        current.children,
        depth + 1,
        activePath[depth + 1]
      );
      columnsWrap.appendChild(column);
    });

    requestAnimationFrame(() => {
      timeline.scrollTo({ left: columnsWrap.scrollWidth, behavior: "smooth" });
    });
  }

  function buildColumn(parentNode, nodes, depth, selectedChildId) {
    const column = document.createElement("section");
    column.className = "mindmap-column";

    const header = document.createElement("header");
    header.className = "mindmap-column__header";
    header.innerHTML = `<span class="mindmap-column__depth">${
      depth + 1
    }</span><span>${parentLabel(parentNode, depth)}</span>`;
    column.appendChild(header);

    const list = document.createElement("div");
    list.className = "mindmap-column__list";

    nodes.forEach((node) => {
      const id = node && node.id ? node.id : null;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mindmap-node-card";
      button.dataset.nodeId = id || "";
      if (id && id === selectedChildId) {
        button.classList.add("mindmap-node-card--active");
      }
      if (id && id === selectedId) {
        button.classList.add("mindmap-node-card--selected");
      }
      if (node && node.children && node.children.length) {
        button.classList.add("mindmap-node-card--expandable");
      }
      if (id && cloneMap[id] && cloneMap[id].length) {
        button.classList.add("mindmap-node-card--clone");
      }

      const name = document.createElement("span");
      name.className = "mindmap-node-card__name";
      name.textContent = node.name || "(unnamed)";

      const type = document.createElement("span");
      type.className = "mindmap-node-card__type";
      type.textContent = node.type || "";

      // Append name and type
      button.append(name, type);

      // Export usage indicators for file nodes and propagated directory status
      if (node && (node.type === "file" || node.type === "directory")) {
        const indicator = document.createElement("span");
        indicator.className = "mindmap-node-card__export-indicator";
        if (node.allExportsUnused) {
          indicator.textContent = "⛔";
          indicator.title =
            node.type === "file"
              ? "All exports appear unused in local imports"
              : "Contains files where all exports appear unused";
          button.appendChild(indicator);
        } else if (node.someExportsUnused) {
          indicator.textContent = "⚠️";
          const unusedList =
            node.type === "file"
              ? Array.isArray(node.unusedExports) && node.unusedExports.length
                ? `: ${node.unusedExports.join(", ")}${
                    node.unusedExportsCount > node.unusedExports.length
                      ? "…"
                      : ""
                  }`
                : ""
              : "";
          indicator.title =
            node.type === "file"
              ? `Some exports appear unused (${node.unusedExportsCount}/${node.exportsCount})${unusedList}`
              : "Contains files with some unused exports";
          button.appendChild(indicator);
        }
      }

      // For file nodes add a small "Find Clone" control beside the type
      if (node && node.type === "file") {
        const findBtn = document.createElement("button");
        findBtn.type = "button";
        findBtn.className = "mindmap-node-card__find-clone";
        findBtn.title = "Find clones for this file";
        findBtn.textContent = "Find Clone";
        // Prevent the card click from firing when pressing this button
        findBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (typeof onNodeSelect === "function") {
            // ensure node is selected first
            handleSelection(node);
          }
          if (typeof options.onFindClones === "function") {
            options.onFindClones(node);
          }
        });
        button.appendChild(findBtn);
      }
      button.addEventListener("click", () => handleSelection(node));
      list.appendChild(button);
    });

    column.appendChild(list);
    return column;
  }

  function handleSelection(node) {
    if (!node || !node.id) {
      return;
    }
    selectedId = node.id;
    activePath = buildPath(node.id, nodeIndex, root.id);
    render();
    onNodeSelect(node);
  }

  render();

  return {
    setSelected(nodeId) {
      if (!nodeId) {
        selectedId = null;
        activePath = [];
        render();
        return;
      }
      if (!nodeIndex.has(nodeId)) {
        return;
      }
      selectedId = nodeId;
      activePath = buildPath(nodeId, nodeIndex, root.id);
      render();
    },
    destroy() {
      container.innerHTML = "";
    },
  };
}

function parentLabel(node, depth) {
  if (!node) {
    return depth === 0 ? "Root" : "Level";
  }
  if (node.type === "root") {
    return node.name || "Root";
  }
  return node.name || node.type || "Group";
}

function buildPath(nodeId, index, rootId) {
  const path = [];
  let currentId = nodeId;
  while (currentId && currentId !== rootId) {
    path.unshift(currentId);
    const node = index.get(currentId);
    if (!node || !node.parentId) {
      break;
    }
    currentId = node.parentId;
  }
  return path;
}

function normaliseIndex(value) {
  if (!value) {
    return new Map();
  }
  if (value instanceof Map) {
    return value;
  }
  return new Map(Object.entries(value));
}

function noopController() {
  return {
    setSelected() {},
    destroy() {},
  };
}
