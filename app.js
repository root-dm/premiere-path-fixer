/* Browser-only project loading, preview, and download. */
(() => {
  const byId = (id) => document.getElementById(id);
  const fileInput = byId('file');
  const oldPathInput = byId('from');
  const newPathInput = byId('to');
  const status = byId('status');
  const scanButton = byId('scan');
  const downloadButton = byId('download');
  const { trimTrailingSeparators, isAbsolutePath, normalizeDestination, escapeXml, rewrite } = window.PathRewrite;

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
    byId('old-root').textContent = '—';
    byId('format').textContent = '—';
    byId('preview').hidden = true;
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

    const oldRoot = trimTrailingSeparators(oldPathInput.value);
    const newRoot = normalizeDestination(newPathInput.value);
    if (!isAbsolutePath(oldPathInput.value.trim()) ||
        !isAbsolutePath(newPathInput.value.trim()) || !oldRoot || !newRoot) {
      return showStatus(
        'Enter two full paths, such as /Volumes/MediaDrive and D:\\, or C:\\Footage and /Volumes/MediaDrive.',
        'error'
      );
    }

    showStatus('Reading the project…');
    scanButton.disabled = true;

    try {
      const project = await readProject(selectedFile);
      const result = rewrite(project.xml, escapeXml(oldRoot), escapeXml(newRoot));

      byId('matches').textContent = result.count.toLocaleString('en-US');
      byId('old-root').textContent = oldRoot;
      byId('format').textContent = project.gzip ? 'Gzip XML' : 'XML';

      if (result.example) {
        byId('preview').hidden = false;
        byId('before').textContent = result.example.original;
        byId('after').textContent = result.example.updated;
      }

      if (!result.count) {
        showStatus('No paths match that prefix. Check the saved path shown in Premiere’s Link Media dialog.', 'error');
        return;
      }

      preparedProject = { xml: result.changed, gzip: project.gzip, name: selectedFile.name };
      downloadButton.disabled = false;
      showStatus('Ready: ' + result.count.toLocaleString('en-US') + ' path references will be updated.', 'ok');
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

  for (const input of [oldPathInput, newPathInput]) {
    input.addEventListener('input', () => {
      clearPreview();
      showStatus('Paths changed. Select “Preview changes” again.');
    });
  }

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
