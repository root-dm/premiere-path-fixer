/* Browser-only project loading, preview, and download. */
(() => {
  const byId = (id) => document.getElementById(id);
  const fileInput = byId('file');
  const mappingList = byId('mappings');
  const status = byId('status');
  const scanButton = byId('scan');
  const downloadButton = byId('download');
  const { trimTrailingSeparators, isAbsolutePath, normalizeDestination, escapeXml, rewriteMany } = window.PathRewrite;

  let selectedFile = null;
  let preparedProject = null;

  function showStatus(message, kind = '') {
    status.textContent = message;
    status.className = 'status ' + kind;
  }

  function clearPreview() {
    preparedProject = null;
    downloadButton.disabled = true;
    byId('matches').textContent = '—';
    byId('rule-count').textContent = '—';
    byId('mapping-results').replaceChildren();
    byId('format').textContent = '—';
    byId('preview').hidden = true;
  }

  function addMapping(from = '', to = '') {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    const source = document.createElement('input');
    source.className = 'path';
    source.placeholder = 'Old folder path';
    source.setAttribute('aria-label', 'Old folder path');
    source.spellcheck = false;
    source.value = from;
    const target = document.createElement('input');
    target.className = 'path';
    target.placeholder = 'New folder path';
    target.setAttribute('aria-label', 'New folder path');
    target.spellcheck = false;
    target.value = to;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove mapping');
    remove.addEventListener('click', () => {
      row.remove();
      if (!mappingList.children.length) addMapping();
      invalidatePreview();
    });
    for (const input of [source, target]) input.addEventListener('input', invalidatePreview);
    row.append(source, target, remove);
    mappingList.append(row);
  }

  function invalidatePreview() {
    clearPreview();
    showStatus('Mappings changed. Select “Preview changes” again.');
  }

  function getMappings() {
    const rows = [...mappingList.querySelectorAll('.mapping-row')];
    const mappings = [];
    for (const row of rows) {
      const [source, target] = row.querySelectorAll('input');
      if (!source.value.trim() && !target.value.trim()) continue;
      if (!isAbsolutePath(source.value.trim()) || !isAbsolutePath(target.value.trim())) {
        throw new Error('Each mapping needs two full folder paths. Check the old and new columns.');
      }
      mappings.push({
        from: escapeXml(trimTrailingSeparators(source.value)),
        to: escapeXml(normalizeDestination(target.value)),
        label: source.value.trim()
      });
    }
    if (!mappings.length) throw new Error('Add at least one path mapping.');
    if (new Set(mappings.map((rule) => rule.from.toLowerCase())).size !== mappings.length) {
      throw new Error('The same old folder appears more than once. Remove the duplicate.');
    }
    return mappings;
  }

  async function readProject(file) {
    const header = new Uint8Array(await file.slice(0, 100).arrayBuffer());
    const gzip = header[0] === 0x1f && header[1] === 0x8b;

    if (!gzip && !new TextDecoder().decode(header).includes('<')) {
      throw new Error('Unrecognized .prproj file format.');
    }
    if (gzip && (!window.DecompressionStream || !window.CompressionStream)) {
      throw new Error('This browser does not support gzip compression. Try a recent version of Chrome or Edge.');
    }

    const xml = gzip
      ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : await file.text();

    if (!/<\?xml\b|<PremiereData\b|<Project\b/.test(xml.slice(0, 600))) {
      throw new Error('No recognizable project XML found.');
    }
    if (!/<\/PremiereData>\s*$|<\/Project>\s*$/.test(xml)) {
      throw new Error('The project XML appears incomplete.');
    }

    return { xml, gzip };
  }

  async function previewChanges() {
    clearPreview();
    selectedFile = fileInput.files[0] || selectedFile;

    if (!selectedFile) return showStatus('Choose a .prproj file first.', 'error');
    if (!/\.prproj$/i.test(selectedFile.name)) return showStatus('Choose a file ending in .prproj.', 'error');
    if (selectedFile.size > 100 * 1024 * 1024) {
      return showStatus('This project exceeds the 100 MB file limit.', 'error');
    }

    let mappings;
    try { mappings = getMappings(); }
    catch (error) { return showStatus(error.message, 'error'); }

    showStatus('Reading the project…');
    scanButton.disabled = true;

    try {
      const project = await readProject(selectedFile);
      const result = rewriteMany(project.xml, mappings);

      byId('matches').textContent = result.count.toLocaleString('en-US');
      byId('rule-count').textContent = mappings.length.toLocaleString('en-US');
      byId('format').textContent = project.gzip ? 'Gzip XML' : 'XML';
      mappings.forEach((rule, index) => {
        const line = document.createElement('div');
        line.className = 'mapping-result';
        const label = document.createElement('span');
        label.textContent = rule.label;
        const total = document.createElement('strong');
        total.textContent = result.counts[index].toLocaleString('en-US');
        line.append(label, total);
        byId('mapping-results').append(line);
      });

      if (result.example) {
        byId('preview').hidden = false;
        byId('before').textContent = result.example.original;
        byId('after').textContent = result.example.updated;
      }

      if (!result.count) {
        showStatus('No paths match these prefixes. Check the saved paths shown in Premiere’s Link Media dialog.', 'error');
        return;
      }

      preparedProject = { xml: result.changed, gzip: project.gzip, name: selectedFile.name };
      downloadButton.disabled = false;
      const missed = result.counts.filter((number) => !number).length;
      showStatus('Ready: ' + result.count.toLocaleString('en-US') + ' path references will be updated.' +
        (missed ? ' ' + missed + ' mapping(s) have zero matches; check their spelling.' : ''), 'ok');
    } catch (error) {
      showStatus(error.message || 'Could not read the project.', 'error');
    } finally {
      scanButton.disabled = false;
    }
  }

  async function downloadProject() {
    if (!preparedProject) return;
    downloadButton.disabled = true;
    showStatus('Preparing the fixed project…');

    try {
      let output = new Blob([new TextEncoder().encode(preparedProject.xml)], {
        type: 'application/octet-stream'
      });
      if (preparedProject.gzip) {
        output = await new Response(output.stream().pipeThrough(new CompressionStream('gzip'))).blob();
      }

      const url = URL.createObjectURL(output);
      const link = document.createElement('a');
      link.href = url;
      link.download = preparedProject.name.replace(/\.prproj$/i, '') + '-paths-fixed.prproj';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showStatus('Downloaded the fixed .prproj. Open it in Premiere.', 'ok');
    } catch (error) {
      showStatus('Could not create the project: ' + error.message, 'error');
    } finally {
      downloadButton.disabled = false;
    }
  }

  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files[0] || null;
    byId('file-label').textContent = selectedFile ? selectedFile.name : 'Choose or drop a .prproj file';
    clearPreview();
    showStatus(selectedFile ? 'Ready to preview.' : 'Choose a project to get started.');
  });

  byId('add-mapping').addEventListener('click', () => addMapping());
  byId('import-mappings').addEventListener('click', () => {
    const lines = byId('bulk-input').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      const match = line.match(/^(.+?)\s*(?:=>|→|\t)\s*(.+)$/);
      if (!match) return showStatus('Use one “old path => new path” mapping per line.', 'error');
      parsed.push([match[1].trim(), match[2].trim()]);
    }
    if (!parsed.length) return showStatus('Paste at least one mapping first.', 'error');
    const first = mappingList.querySelector('.mapping-row');
    if (mappingList.children.length === 1 && [...first.querySelectorAll('input')].every((input) => !input.value.trim())) first.remove();
    parsed.forEach(([from, to]) => addMapping(from, to));
    byId('bulk-input').value = '';
    invalidatePreview();
  });
  addMapping();

  const dropZone = byId('drop');
  for (const event of ['dragenter', 'dragover']) {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag');
    });
  }
  for (const event of ['dragleave', 'drop']) {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag');
    });
  }
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change'));
  });

  scanButton.addEventListener('click', previewChanges);
  downloadButton.addEventListener('click', downloadProject);
})();
