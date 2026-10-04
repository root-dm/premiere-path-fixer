/* Path replacement logic, independent of file handling and the UI. */
window.PathRewrite = (() => {
  function trimTrailingSeparators(value) {
    return value.trim().replace(/[\\/]+$/, '');
  }

  function isAbsolutePath(value) {
    return /^\/[^/]/.test(value) ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\[^\\]+\\[^\\]+/.test(value);
  }

  function normalizeDestination(value) {
    const raw = value.trim();
    const isWindows = /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\[^\\]+\\[^\\]+/.test(raw);
    return trimTrailingSeparators(isWindows ? raw.replace(/\//g, '\\') : raw);
  }

  function escapeXml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replaceInValue(value, oldRoot, newRoot) {
    // Require a separator after the prefix so similarly named disks stay intact.
    const prefix = new RegExp(
      '(^|[^A-Za-z0-9_])(' + escapeRegex(oldRoot) + ')(?=[/\\\\])',
      'g'
    );

    let count = 0;
    const replaced = value.replace(prefix, (_match, leading) => {
      count++;
      return leading + newRoot;
    });
    if (!count) return { value, count };

    const separator = newRoot.startsWith('/') ? '/' : '\\';
    const suffix = new RegExp('(^|[^A-Za-z0-9_])' + escapeRegex(newRoot) + '([\\s\\S]*)');
    const converted = replaced.replace(
      suffix,
      (_match, leading, tail) => leading + newRoot + tail.replace(/[\\/]/g, separator)
    );

    return { value: converted, count };
  }

  function rewrite(xml, oldRoot, newRoot) {
    const result = rewriteMany(xml, [{ from: oldRoot, to: newRoot }]);
    return { changed: result.changed, count: result.count, example: result.example };
  }

  function rewriteMany(xml, mappings) {
    let count = 0;
    let example = null;
    const counts = mappings.map(() => 0);
    // More specific folders take precedence over their parent folders.
    const order = mappings.map((_, index) => index)
      .sort((a, b) => mappings[b].from.length - mappings[a].from.length);

    // Keep the rest of Premiere's XML and its object identifiers unchanged.
    const changed = xml.replace(/>([^<]*)<|="([^"]*)"/g, (_whole, text, attribute) => {
      const original = text === undefined ? attribute : text;
      let result = { value: original, count: 0 };
      for (const index of order) {
        const candidate = replaceInValue(original, mappings[index].from, mappings[index].to);
        if (!candidate.count) continue;
        result = candidate;
        counts[index] += candidate.count;
        break; // Match against the original value; do not cascade replacements.
      }
      count += result.count;

      if (!example && result.count) {
        example = { original, updated: result.value };
      }

      return text === undefined ? '="' + result.value + '"' : '>' + result.value + '<';
    });

    return { changed, count, counts, example };
  }

  return { trimTrailingSeparators, isAbsolutePath, normalizeDestination, escapeXml, rewrite, rewriteMany };
})();
