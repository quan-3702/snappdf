// SnapPDF – combine images into one PDF (runs fully in the browser, offline)
const $ = (id) => document.getElementById(id);
const pages = []; // { id, file, url, rot }
let nextId = 1;
let dragId = null;

const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a5: [419.53, 595.28] };
const MAX_SIDE = 3000; // downscale huge photos to keep the PDF reasonable

function fmtBytes(n) {
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function addFiles(list) {
  for (const file of list) {
    if (!file || !file.type.startsWith('image/')) continue;
    pages.push({ id: nextId++, file, url: URL.createObjectURL(file), rot: 0 });
  }
  render();
}

function move(from, to) {
  if (from === to || to < 0 || to >= pages.length) return;
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  render();
}

function render() {
  const grid = $('grid');
  grid.innerHTML = '';
  pages.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'page';
    li.draggable = true;
    li.dataset.id = p.id;
    li.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="thumb"><img src="${p.url}" alt="" style="transform: rotate(${p.rot}deg)"></div>
      <div class="pname"></div>
      <div class="tools">
        <button class="icon" data-a="left" title="Move left">◀</button>
        <button class="icon" data-a="rot" title="Rotate 90°">⟳</button>
        <button class="icon" data-a="right" title="Move right">▶</button>
        <button class="icon" data-a="rm" title="Remove">✕</button>
      </div>`;
    li.querySelector('.pname').textContent = p.file.name;
    li.querySelector('[data-a="left"]').onclick = () => move(i, i - 1);
    li.querySelector('[data-a="right"]').onclick = () => move(i, i + 1);
    li.querySelector('[data-a="rot"]').onclick = () => { p.rot = (p.rot + 90) % 360; render(); };
    li.querySelector('[data-a="rm"]').onclick = () => { URL.revokeObjectURL(p.url); pages.splice(i, 1); render(); };

    li.addEventListener('dragstart', (e) => { dragId = p.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); });
    li.addEventListener('dragover', (e) => { if (dragId !== null) { e.preventDefault(); li.classList.add('target'); } });
    li.addEventListener('dragleave', () => li.classList.remove('target'));
    li.addEventListener('drop', (e) => {
      if (dragId === null) return;
      e.preventDefault(); e.stopPropagation();
      li.classList.remove('target');
      move(pages.findIndex((x) => x.id === dragId), i);
    });
    grid.appendChild(li);
  });
  const n = pages.length;
  $('count').textContent = n ? `${n} page${n > 1 ? 's' : ''}` : 'No pages yet';
  $('empty').hidden = n > 0;
  ['clear', 'sortName', 'reverse'].forEach((id) => { $(id).disabled = !n; });
  $('make').disabled = !n;
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file); } catch (_) {}
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Can't read ${file.name}`));
    img.src = URL.createObjectURL(file);
  });
}

// Draw the image rotated + downscaled on a white canvas, return JPEG bytes and size
async function prepare(p, quality) {
  const bmp = await loadBitmap(p.file);
  let w = bmp.width, h = bmp.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  const turned = p.rot === 90 || p.rot === 270;
  const cw = turned ? h : w, ch = turned ? w : h;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: cw, h: ch };
}

// Minimal PDF writer: one JPEG image per page (DCTDecode), no dependencies
function buildPdf(list) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const n = list.length;
  // Object numbers: 1 catalog, 2 pages tree, then 3 per page: page, content, image
  const pageObj = (i) => 3 + i * 3;
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\x80-\xFF]/g, 'X'));
  const obj = (num, body) => { offsets[num] = pos; put(`${num} 0 obj\n`); body(); put('\nendobj\n'); };
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put(`<< /Type /Pages /Count ${n} /Kids [${list.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  list.forEach((p, i) => {
    const po = pageObj(i);
    obj(po, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.pw)} ${f(p.ph)}] ` +
      `/Resources << /XObject << /Im0 ${po + 2} 0 R >> >> /Contents ${po + 1} 0 R >>`));
    const content = `q ${f(p.dw)} 0 0 ${f(p.dh)} ${f(p.x)} ${f(p.y)} cm /Im0 Do Q`;
    obj(po + 1, () => { put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); });
    obj(po + 2, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
      put(p.bytes);
      put('\nendstream');
    });
  });
  const total = 3 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  put(x);
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function pageFor(img, s) {
  if (s.size === 'fit') return { pw: img.w * 0.75, ph: img.h * 0.75, m: 0 };
  let [pw, ph] = SIZES[s.size];
  const land = s.orient === 'l' || (s.orient === 'auto' && img.w > img.h);
  if (land) [pw, ph] = [ph, pw];
  return { pw, ph, m: s.margin };
}

async function makePdf() {
  const s = {
    size: $('size').value, orient: $('orient').value,
    margin: Number($('margin').value), quality: Number($('quality').value) / 100,
  };
  const btn = $('make');
  btn.disabled = true;
  const out = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      btn.textContent = `Adding page ${i + 1}/${pages.length}…`;
      const img = await prepare(pages[i], s.quality);
      const { pw, ph, m } = pageFor(img, s);
      const k = Math.min((pw - 2 * m) / img.w, (ph - 2 * m) / img.h);
      const dw = img.w * k, dh = img.h * k;
      out.push({ ...img, pw, ph, x: (pw - dw) / 2, y: (ph - dh) / 2, dw, dh });
    }
    const blob = buildPdf(out);
    const name = ($('fname').value.trim() || 'images').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.pdf$/i, '') + '.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    const sum = $('summary');
    sum.hidden = false;
    sum.innerHTML = `<strong>${name}</strong> · ${pages.length} page${pages.length > 1 ? 's' : ''} · ${fmtBytes(blob.size)}`;
  } catch (e) {
    const sum = $('summary');
    sum.hidden = false;
    sum.textContent = 'Something went wrong: ' + (e.message || e);
  } finally {
    btn.textContent = 'Create PDF';
    btn.disabled = !pages.length;
  }
}

// --- Wire up UI ---
const drop = $('drop');
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (ev) => addFiles(ev.dataTransfer.files));
drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') $('picker').click(); });
$('picker').addEventListener('change', (ev) => { addFiles(ev.target.files); ev.target.value = ''; });
// Also accept files dropped anywhere on the page (except page reordering)
document.addEventListener('dragover', (e) => { if (dragId === null) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (dragId === null && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
document.addEventListener('paste', (ev) => {
  const files = [...ev.clipboardData.items].filter((i) => i.kind === 'file').map((i) => {
    const f = i.getAsFile();
    return new File([f], `pasted-${Date.now()}.${f.type.split('/')[1] || 'png'}`, { type: f.type });
  });
  addFiles(files);
});

$('clear').onclick = () => { pages.forEach((p) => URL.revokeObjectURL(p.url)); pages.length = 0; $('summary').hidden = true; render(); };
$('reverse').onclick = () => { pages.reverse(); render(); };
$('sortName').onclick = () => { pages.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })); render(); };
$('make').onclick = makePdf;
$('quality').addEventListener('input', () => { $('qualityOut').textContent = $('quality').value; });
function syncFields() {
  const fit = $('size').value === 'fit';
  $('orientField').hidden = fit;
  $('marginField').hidden = fit;
}
$('size').addEventListener('change', syncFields);

// Remember settings
const KEYS = ['size', 'orient', 'margin', 'quality'];
try {
  const saved = JSON.parse(localStorage.getItem('snappdf-settings') || '{}');
  KEYS.forEach((k) => { if (saved[k] != null) $(k).value = saved[k]; });
  $('qualityOut').textContent = $('quality').value;
} catch (_) {}
syncFields();
KEYS.forEach((k) => $(k).addEventListener('change', () => {
  try { localStorage.setItem('snappdf-settings', JSON.stringify(Object.fromEntries(KEYS.map((x) => [x, $(x).value])))); } catch (_) {}
}));

// "Open with SnapPDF" from File Explorer
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) addFiles(await Promise.all(params.files.map((h) => h.getFile())));
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
render();
