const MAX_ITEMS = 5;

function computeDependencyInsights(dependencies) {
  if (!dependencies || !Array.isArray(dependencies.edges)) {
    return { fanOut: [], fanIn: [], externalPackages: [] };
  }

  const fanOutMap = new Map();
  const fanInMap = new Map();
  const externalMap = new Map();

  dependencies.edges.forEach((edge) => {
    if (!edge || !edge.source) {
      return;
    }

    const source = edge.source;
    fanOutMap.set(source, (fanOutMap.get(source) || 0) + 1);

    if (edge.kind === 'local' && edge.target) {
      fanInMap.set(edge.target, (fanInMap.get(edge.target) || 0) + 1);
    } else if (edge.kind === 'external' && edge.target) {
      const pkg = extractPackageName(edge.target);
      if (pkg) {
        externalMap.set(pkg, (externalMap.get(pkg) || 0) + 1);
      }
    }
  });

  return {
    fanOut: pickTopEntries(fanOutMap),
    fanIn: pickTopEntries(fanInMap),
    externalPackages: pickTopEntries(externalMap)
  };
}

function pickTopEntries(map) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ITEMS)
    .map(([path, count]) => ({ path, count }));
}

function extractPackageName(specifier) {
  if (!specifier) {
    return null;
  }

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return null;
  }

  if (specifier.startsWith('@')) {
    const scopedParts = specifier.split('/');
    if (scopedParts.length >= 2) {
      return scopedParts[0] + '/' + scopedParts[1];
    }
    return specifier;
  }

  const firstSegment = specifier.split('/')[0];
  return firstSegment || null;
}

module.exports = {
  computeDependencyInsights
};
