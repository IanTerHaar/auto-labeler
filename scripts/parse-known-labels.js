function parseKnownLabels(input) {
  if (!input) return [];
  return input
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0);
}

module.exports = { parseKnownLabels };
