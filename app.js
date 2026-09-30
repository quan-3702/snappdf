// SnapPDF – combine images into one PDF (runs fully in the browser, offline)
const $ = (id) => document.getElementById(id);
const pages = []; // { id, file, url, rot }
let nextId = 1;
let dragId = null;

const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a5: [419.53, 595.28] };
const MAX_SIDE = 3000; // downscale huge photos to keep the PDF reasonable

// ---------- Pro (Microsoft Store add-on via Digital Goods API) ----------
const FREE_PAGES = 10;
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'snappdf_pro';
const PRO_IDS = [PRO_SKU, '9PCWXWLK1FJQ']; // product ID or Store ID, whichever the Store reports
const STORE_URL = 'https://apps.microsoft.com/detail/9NF418NKG80Z';
let proAvailable = false; // Pro limits apply only when the Store actually sells the add-on
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('snappdf-pro') === '1'; } catch (_) {}
const unlocked = () => isPro || !proAvailable;

async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}

function setPro(v) {
  isPro = v;
  try { localStorage.setItem('snappdf-pro', v ? '1' : '0'); } catch (_) {}
  document.body.classList.toggle('is-pro', v);
  document.body.classList.toggle('pro-off', !proAvailable && !v);
  const b = $('proBtn');
  b.textContent = v ? '★ Pro' : '★ Get Pro';
  b.classList.toggle('is-pro', v);
  b.hidden = !proAvailable && !v;
  const scanOpt = $('mode').querySelector('option[value="scan"]');
  scanOpt.textContent = unlocked() ? 'Scan document (B&W)' : 'Scan document (B&W) ★ Pro';
}

async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) proSku = details[0].itemId;
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}

function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }

async function openPro(reason) {
  proMessage(reason || '');
  const svc = await billing();
  if (!svc) {
    $('buyBtn').textContent = 'Get SnapPDF on Microsoft Store';
    $('restoreBtn').hidden = true;
  } else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}

async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) {
    proMessage('Thank you! Pro is unlocked. ★');
    setTimeout(() => $('proDialog').close(), 1500);
  }
}

// Returns true (and shows the upsell) when the settings need Pro
function needsPro(s) {
  if (unlocked()) return false;
  if (pages.length > FREE_PAGES) {
    openPro(`The free version makes PDFs of up to ${FREE_PAGES} pages (you have ${pages.length}). Unlock Pro for unlimited pages.`);
    return true;
  }
  const used = [];
  if (s.mode === 'scan') used.push('scan mode');
  if (s.target) used.push('compress to a size');
  if (s.wm) used.push('watermark');
  if (s.pageNums) used.push('page numbers');
  if (s.password) used.push('password');
  if (!used.length) return false;
  openPro(`${used.join(', ')} ${used.length > 1 ? 'are Pro features' : 'is a Pro feature'}. Unlock Pro, or turn ${used.length > 1 ? 'them' : 'it'} off to continue for free.`);
  return true;
}

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
  let label = n ? `${n} page${n > 1 ? 's' : ''}` : 'No pages yet';
  if (n > FREE_PAGES && !unlocked()) label += ` · free version: up to ${FREE_PAGES}`;
  $('count').textContent = label;
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

// "Scan" filter: flatten uneven lighting, white paper, crisp dark text
function scanFilter(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // 1) estimate the paper brightness at low resolution (max filter removes text, then blur)
  const sw = Math.max(8, Math.round(w / 12)), sh = Math.max(8, Math.round(h / 12));
  const small = document.createElement('canvas'); small.width = sw; small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh);
  let lum = new Float32Array(sw * sh);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.299 * sd.data[j] + 0.587 * sd.data[j + 1] + 0.114 * sd.data[j + 2];
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(lum.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(sh - 1, Math.max(0, y + dy)), xx = Math.min(sw - 1, Math.max(0, x + dx));
        const v = lum[yy * sw + xx]; if (v > m) m = v;
      }
      out[y * sw + x] = m;
    }
    lum = out;
  }
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) { sd.data[j] = sd.data[j + 1] = sd.data[j + 2] = lum[i]; sd.data[j + 3] = 255; }
  sctx.putImageData(sd, 0, 0);
  const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
  const bctx = bg.getContext('2d', { willReadFrequently: true });
  bctx.filter = `blur(${Math.max(2, Math.round(Math.min(w, h) / 150))}px)`;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  const bgd = bctx.getImageData(0, 0, w, h).data;
  // 2) divide by background, then stretch contrast
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let j = 0; j < d.length; j += 4) {
    const g = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    let v = (g / Math.max(bgd[j], 1)) * 255;
    v = (v - 110) * (255 / (235 - 110));
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    v = 255 * Math.pow(v / 255, 1.6); // darken strokes
    d[j] = d[j + 1] = d[j + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function drawWatermark(ctx, w, h, text) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.atan2(h, w));
  let fs = Math.min(w, h) * 0.14;
  ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
  const maxW = Math.hypot(w, h) * 0.7;
  const tw = ctx.measureText(text).width;
  if (tw > maxW) { fs *= maxW / tw; ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, fs / 30);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = 'rgba(90, 90, 90, 0.42)';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Draw the image (rotated, downscaled, filtered) on a white canvas, return JPEG bytes and size
async function prepare(p, o) {
  const bmp = await loadBitmap(p.file);
  let w = bmp.width, h = bmp.height;
  const scale = Math.min(1, o.side / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
  const turned = p.rot === 90 || p.rot === 270;
  const cw = turned ? h : w, ch = turned ? w : h;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: o.mode === 'scan' });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  if (o.mode === 'gray') ctx.filter = 'grayscale(1)';
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (bmp.close) bmp.close();
  if (o.mode === 'scan') scanFilter(c);
  if (o.wm) drawWatermark(ctx, cw, ch, o.wm);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', o.quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: cw, h: ch };
}

// ---------- PDF encryption (Standard security handler, RC4 128-bit, R3) ----------
function md5(input) {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const len = input.length;
  const nb = ((len + 8) >> 6) + 1;
  const msg = new Uint8Array(nb * 64);
  msg.set(input); msg[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(msg.buffer);
  dv.setUint32(nb * 64 - 8, bits >>> 0, true);
  dv.setUint32(nb * 64 - 4, Math.floor(bits / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let b = 0; b < nb; b++) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(b * 64 + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i & 3)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const PDF_PAD = new Uint8Array([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);
const concat = (...arrs) => { const o = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let p = 0; arrs.forEach((a) => { o.set(a, p); p += a.length; }); return o; };
function padPw(pw) {
  const b = new TextEncoder().encode(pw).slice(0, 32);
  return concat(b, PDF_PAD.slice(0, 32 - b.length));
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function makeEncryption(password) {
  const id = crypto.getRandomValues(new Uint8Array(16));
  const P = -4; // all permissions
  const user = padPw(password), owner = padPw(password);
  // O entry (algorithm 3)
  let h = md5(owner);
  for (let i = 0; i < 50; i++) h = md5(h);
  let O = rc4(h, user);
  for (let i = 1; i <= 19; i++) O = rc4(h.map((x) => x ^ i), O);
  // file key (algorithm 2)
  const pBytes = new Uint8Array(4); new DataView(pBytes.buffer).setInt32(0, P, true);
  let key = md5(concat(user, O, pBytes, id));
  for (let i = 0; i < 50; i++) key = md5(key);
  // U entry (algorithm 5)
  let U = rc4(key, md5(concat(PDF_PAD, id)));
  for (let i = 1; i <= 19; i++) U = rc4(key.map((x) => x ^ i), U);
  U = concat(U, new Uint8Array(16));
  const objKey = (num) => md5(concat(key, new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])));
  return {
    id, dict: `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${hex(O)}> /U <${hex(U)}> >>`,
    stream: (num, bytes) => rc4(objKey(num), bytes),
  };
}

// Helvetica widths for the characters used in page numbers
const HELV = { ' ': 278, '/': 278 };
'0123456789'.split('').forEach((d) => { HELV[d] = 556; });
const textWidth = (t, size) => t.split('').reduce((n, ch) => n + (HELV[ch] || 556), 0) * size / 1000;

// Minimal PDF writer: one JPEG image per page (DCTDecode), optional page numbers and password
function buildPdf(list, opts = {}) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const n = list.length;
  const pageObj = (i) => 3 + i * 3; // page, content, image
  const fontObj = 3 + n * 3;
  const encObj = fontObj + 1;
  const crypt = opts.password ? makeEncryption(opts.password) : null;
  const stream = (num, bytes, dict = '') => {
    const data = crypt ? crypt.stream(num, bytes) : bytes;
    put(`<< ${dict}/Length ${data.length} >>\nstream\n`); put(data); put('\nendstream');
  };
  put('%PDF-1.4\n%XXXX\n');
  const obj = (num, body) => { offsets[num] = pos; put(`${num} 0 obj\n`); body(); put('\nendobj\n'); };
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put(`<< /Type /Pages /Count ${n} /Kids [${list.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  list.forEach((p, i) => {
    const po = pageObj(i);
    const font = opts.pageNums ? ` /Font << /F1 ${fontObj} 0 R >>` : '';
    obj(po, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.pw)} ${f(p.ph)}] ` +
      `/Resources << /XObject << /Im0 ${po + 2} 0 R >>${font} >> /Contents ${po + 1} 0 R >>`));
    let content = `q ${f(p.dw)} 0 0 ${f(p.dh)} ${f(p.x)} ${f(p.y)} cm /Im0 Do Q`;
    if (opts.pageNums) {
      const label = `${i + 1} / ${n}`;
      const fs = 9;
      const y = p.m >= 20 ? Math.max(6, p.m / 2 - fs * 0.35) : 8;
      content += `\nBT /F1 ${fs} Tf 0.35 0.35 0.35 rg ${f((p.pw - textWidth(label, fs)) / 2)} ${f(y)} Td (${label}) Tj ET`;
    }
    obj(po + 1, () => stream(po + 1, enc.encode(content)));
    obj(po + 2, () => stream(po + 2, p.bytes,
      `/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `));
  });
  obj(fontObj, () => put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  if (crypt) obj(encObj, () => put(crypt.dict));
  const total = crypt ? encObj + 1 : fontObj + 1;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  put(x);
  const id = crypt ? hex(crypt.id) : hex(crypto.getRandomValues(new Uint8Array(16)));
  put(`trailer\n<< /Size ${total} /Root 1 0 R /ID [<${id}> <${id}>]${crypt ? ` /Encrypt ${encObj} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function pageFor(img, s) {
  if (s.size === 'fit') return { pw: img.w * 0.75, ph: img.h * 0.75, m: 0 };
  let [pw, ph] = SIZES[s.size];
  const land = s.orient === 'l' || (s.orient === 'auto' && img.w > img.h);
  if (land) [pw, ph] = [ph, pw];
  return { pw, ph, m: s.margin };
}

function settings() {
  return {
    size: $('size').value, orient: $('orient').value, margin: Number($('margin').value),
    quality: Number($('quality').value) / 100, mode: $('mode').value, target: Number($('target').value) * 1024,
    wm: $('wmText').value.trim(), pageNums: $('pageNums').checked, password: $('password').value,
  };
}

async function renderPages(s, o, onPage) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onPage(i);
    const img = await prepare(pages[i], o);
    const { pw, ph, m } = pageFor(img, s);
    const k = Math.min((pw - 2 * m) / img.w, (ph - 2 * m) / img.h);
    const dw = img.w * k, dh = img.h * k;
    out.push({ ...img, pw, ph, m, x: (pw - dw) / 2, y: (ph - dh) / 2, dw, dh });
  }
  return out;
}

async function makePdf() {
  const s = settings();
  if (needsPro(s)) return;
  const btn = $('make');
  const sum = $('summary');
  btn.disabled = true;
  try {
    const o = { quality: s.target ? 0.85 : s.quality, side: MAX_SIDE, mode: s.mode, wm: s.wm };
    let out, pass = 0, blob, note = '';
    for (;;) {
      pass++;
      out = await renderPages(s, o, (i) => {
        btn.textContent = `${pass > 1 ? `Compressing (pass ${pass}) · ` : ''}page ${i + 1}/${pages.length}…`;
      });
      blob = buildPdf(out, s);
      if (!s.target || blob.size <= s.target) break;
      if (pass >= 8 || (o.side <= 500 && o.quality <= 0.4)) { note = ` · couldn't reach ${fmtBytes(s.target)} – try fewer pages`; break; }
      const ratio = s.target / blob.size;
      if (ratio > 0.6 && o.quality > 0.55) o.quality = Math.max(0.4, o.quality - 0.15);
      else o.side = Math.max(500, Math.round(Math.min(o.side, Math.max(...out.map((p) => Math.max(p.w, p.h)))) * Math.sqrt(ratio) * 0.9));
    }
    const name = ($('fname').value.trim() || 'images').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.pdf$/i, '') + '.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    sum.hidden = false;
    sum.innerHTML = `<strong></strong> · ${pages.length} page${pages.length > 1 ? 's' : ''} · ${fmtBytes(blob.size)}${s.password ? ' · 🔒 password protected' : ''}${note}`;
    sum.querySelector('strong').textContent = name;
  } catch (e) {
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
  $('qualityField').hidden = $('target').value !== '0';
}
['size', 'target'].forEach((id) => $(id).addEventListener('change', syncFields));

// Pro UI
$('proBtn').addEventListener('click', () => { if (!isPro) openPro(); });
$('buyBtn').addEventListener('click', buyPro);
$('restoreBtn').addEventListener('click', async () => {
  proMessage('Checking your purchases…');
  proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.');
});
$('closePro').addEventListener('click', () => $('proDialog').close());

// Remember settings (never the password)
const KEYS = ['size', 'orient', 'margin', 'quality', 'mode', 'target', 'wmText'];
try {
  const saved = JSON.parse(localStorage.getItem('snappdf-settings') || '{}');
  KEYS.forEach((k) => { if (saved[k] != null) $(k).value = saved[k]; });
  if (saved.pageNums != null) $('pageNums').checked = saved.pageNums;
  $('qualityOut').textContent = $('quality').value;
} catch (_) {}
syncFields();
const saveSettings = () => {
  try {
    const o = Object.fromEntries(KEYS.map((x) => [x, $(x).value]));
    o.pageNums = $('pageNums').checked;
    localStorage.setItem('snappdf-settings', JSON.stringify(o));
  } catch (_) {}
};
[...KEYS, 'pageNums'].forEach((k) => $(k).addEventListener('change', saveSettings));

// "Open with SnapPDF" from File Explorer
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) addFiles(await Promise.all(params.files.map((h) => h.getFile())));
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
setPro(isPro);
checkPro().then(render);
render();
