const path = require('path');

function buildFileTree(files, directories) {
  const nodes = new Map();

  function ensureDirectoryNode(dirPath, name) {
    if (!nodes.has(dirPath)) {
      nodes.set(dirPath, {
        type: 'directory',
        name: name !== undefined ? name : (path.basename(dirPath === '.' ? '' : dirPath) || '.'),
        path: dirPath,
        children: [],
        metrics: {}
      });
    }
    return nodes.get(dirPath);
  }

  const rootNode = ensureDirectoryNode('.', '.');

  for (const dir of directories) {
    ensureDirectoryNode(dir.path, dir.path === '.' ? '.' : path.basename(dir.path));
  }

  for (const dir of directories) {
    if (dir.path === '.') continue;
    const parentPath = path.dirname(dir.path);
    const parentNode = ensureDirectoryNode(parentPath, path.basename(parentPath));
    const node = nodes.get(dir.path);
    if (!parentNode.children.includes(node)) {
      parentNode.children.push(node);
    }
  }

  for (const file of files) {
    const parentPath = path.dirname(file.path);
    const parentNode = ensureDirectoryNode(parentPath, path.basename(parentPath));
    parentNode.children.push({
      type: 'file',
      name: file.name,
      path: file.path,
      ext: file.ext,
      size: file.size,
      metrics: {}
    });
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  return rootNode;
}

module.exports = {
  buildFileTree
};
