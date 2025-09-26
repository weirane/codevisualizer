const fs = require('fs');
const path = require('path');
const { detectLanguage } = require('./language');

const DEFAULT_MAX_FILE_SIZE = 512 * 1024; // 512KB per file

function computeFileMetrics(rootPath, files, options = {}) {
  const maxFileSize = options.maxFileSize !== undefined ? options.maxFileSize : DEFAULT_MAX_FILE_SIZE;
  const metricsByFile = new Map();
  const issues = [];

  for (const file of files) {
    const absPath = path.resolve(rootPath, file.path);
    const fileMetrics = {
      language: detectLanguage(file.ext),
      size: file.size,
      lineCount: null,
      complexityScore: null,
      todoCount: 0,
      skipped: false
    };

    if (file.size > maxFileSize) {
      fileMetrics.skipped = true;
      issues.push({
        severity: 'info',
        type: 'file-too-large',
        path: file.path,
        message: `Skipped reading ${file.path} (${formatBytes(file.size)}) to keep analysis fast.`
      });
      metricsByFile.set(file.path, fileMetrics);
      continue;
    }

    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (error) {
      fileMetrics.skipped = true;
      issues.push({
        severity: 'warning',
        type: 'file-read-error',
        path: file.path,
        message: `Could not read file: ${error.message}`
      });
      metricsByFile.set(file.path, fileMetrics);
      continue;
    }

    const lines = content.split(/\r?\n/);
    const lineCount = lines.length;
    const decisionPoints = countMatches(content, /\b(if|else if|for|while|case|catch|throw|function|class|=>|switch)\b/g);
    const todoCount = countMatches(content, /\b(TODO|FIXME|HACK|XXX)\b/g);
    const complexityScore = lineCount ? Number(((decisionPoints / lineCount) * 100).toFixed(2)) : 0;

    fileMetrics.lineCount = lineCount;
    fileMetrics.todoCount = todoCount;
    fileMetrics.complexityScore = complexityScore;

    if (lineCount > 300) {
      issues.push({
        severity: 'warning',
        type: 'large-file',
        path: file.path,
        message: `${file.path} has ${lineCount} lines; consider breaking it down.`
      });
    }

    if (complexityScore > 35) {
      issues.push({
        severity: 'warning',
        type: 'high-complexity',
        path: file.path,
        message: `${file.path} has high decision density (${complexityScore} decisions per 100 lines).`
      });
    }

    if (todoCount > 0) {
      issues.push({
        severity: 'info',
        type: 'todo-comments',
        path: file.path,
        message: `${todoCount} TODO-like comments found.`
      });
    }

    metricsByFile.set(file.path, fileMetrics);
  }

  return { metricsByFile, issues };
}

function countMatches(value, regex) {
  const matches = value.match(regex);
  return matches ? matches.length : 0;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let count = bytes;
  while (count >= 1024 && index < units.length - 1) {
    count /= 1024;
    index += 1;
  }
  return `${count.toFixed(1)} ${units[index]}`;
}

module.exports = {
  computeFileMetrics
};
