const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.cache',
  '.next',
  '.nuxt',
  '.DS_Store',
  '.idea',
  '.vscode',
  'coverage',
  'ios/Pods',
  '__pycache__'
]);

const DEFAULT_IGNORED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db'
]);

/**
 * Recursively walks a directory and gathers metadata.
 * The walk stops when maxEntries is reached to keep analysis bounded.
 */
function collectEntries(rootPath, options = {}) {
  const {
    ignoredDirectories = DEFAULT_IGNORED_DIRECTORIES,
    ignoredFiles = DEFAULT_IGNORED_FILES,
    maxEntries = 2000
  } = options;

  const rootStat = safeStat(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`);
  }

  const stack = [{ absPath: rootPath, relativePath: '.', depth: 0 }];
  const files = [];
  const directories = [];
  const warnings = [];

  while (stack.length) {
    const current = stack.pop();
    const { absPath, relativePath, depth } = current;

    const dirStat = safeStat(absPath);
    if (!dirStat) {
      warnings.push({ type: 'stat-error', path: relativePath });
      continue;
    }

    directories.push({
      path: relativePath,
      name: path.basename(absPath),
      depth,
      mtimeMs: dirStat.mtimeMs
    });

    let entries;
    try {
      entries = fs.readdirSync(absPath, { withFileTypes: true });
    } catch (error) {
      warnings.push({ type: 'read-error', path: relativePath, error: error.message });
      continue;
    }

    for (const entry of entries) {
      if (ignoredFiles.has(entry.name)) {
        continue;
      }

      const entryAbsPath = path.join(absPath, entry.name);
      const entryRelativePath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }

        if (directories.length + files.length >= maxEntries) {
          warnings.push({ type: 'limit-reached', path: entryRelativePath });
          return { files, directories, warnings, truncated: true };
        }

        stack.push({ absPath: entryAbsPath, relativePath: entryRelativePath, depth: depth + 1 });
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        const stats = safeStat(entryAbsPath);
        if (!stats) {
          warnings.push({ type: 'stat-error', path: entryRelativePath });
          continue;
        }

        files.push({
          path: entryRelativePath,
          name: entry.name,
          ext: path.extname(entry.name).toLowerCase(),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          isSymbolicLink: entry.isSymbolicLink(),
          depth
        });

        if (directories.length + files.length >= maxEntries) {
          warnings.push({ type: 'limit-reached', path: entryRelativePath });
          return { files, directories, warnings, truncated: true };
        }
      }
    }
  }

  return { files, directories, warnings, truncated: false };
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (error) {
    return null;
  }
}

module.exports = {
  collectEntries
};
