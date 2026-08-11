function extractLabelStates(body, knownLabels) {
  const known = new Set(knownLabels.map((l) => l.toLowerCase()));
  const checked = new Set();
  const unchecked = new Set();

  const lineRe = /^\s*[-*]\s*\[([ xX])\]\s*(.+?)\s*$/gm;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    const isChecked = m[1].toLowerCase() === 'x';
    const label = m[2].trim().toLowerCase();
    if (known.has(label)) {
      if (isChecked) checked.add(label);
      else unchecked.add(label);
    }
  }

  return { checked, unchecked };
}

module.exports = { extractLabelStates };
