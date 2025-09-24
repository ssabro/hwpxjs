// 간단 브라우저 파서: JSZip + DOMParser
const dropzone = document.getElementById('dropzone');
const elSummary = document.getElementById('summary');
const elText = document.getElementById('text');
const elHtml = document.getElementById('html');

dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.opacity = '0.8'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.opacity = '1'; });
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault(); dropzone.style.opacity = '1';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = {};
  const names = Object.keys(zip.files);
  await Promise.all(names.map(async (name) => {
    const f = zip.file(name);
    if (!f) return;
    files[name] = new Uint8Array(await f.async('uint8array'));
  }));

  // summary
  const hasEncryptionInfo = !!files['META-INF/manifest.xml'];
  const contentsFiles = Object.keys(files).filter(p => p.startsWith('Contents/')).sort();
  elSummary.textContent = JSON.stringify({ hasEncryptionInfo, contentsFiles }, null, 2);

  // read text from Contents/section*.xml
  const dec = new TextDecoder('utf-8');
  const sectionPaths = Object.keys(files).filter(p => /^Contents\/section\d+\.xml$/.test(p)).sort((a,b)=>{
    const na = Number(a.match(/section(\d+)\.xml/)?.[1] ?? 0);
    const nb = Number(b.match(/section(\d+)\.xml/)?.[1] ?? 0);
    return na - nb;
  });

  const paragraphs = [];
  for (const path of sectionPaths) {
    const xmlText = dec.decode(files[path]);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const tNodes = doc.getElementsByTagName('hp:t');
    if (tNodes && tNodes.length) {
      let buf = '';
      for (const n of tNodes) buf += n.textContent || '';
      paragraphs.push(buf);
    } else {
      paragraphs.push('');
    }
  }
  elText.textContent = paragraphs.join('\n');

  // very simple HTML
  elHtml.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
});

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


