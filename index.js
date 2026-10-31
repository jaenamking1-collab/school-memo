const $ = (id) => document.getElementById(id);
const ed = $('ed'), title = $('title');
let current = null; // 지금 열린 파일명. 새 메모면 null
let color = '#fdf07a';
let sel = null; // 고른 사진

const setColor = (hex) => {
  color = hex;
  document.documentElement.style.setProperty('--bg', hex);
};

// ---- 저장 ----
const empty = () => !title.textContent.trim() && !ed.textContent.trim() && !ed.querySelector('img');

// 제목을 안 적었으면 본문의 첫 글이 제목 노릇을 한다
const firstLine = () => (ed.innerText.split('\n').map((s) => s.trim()).find(Boolean) || '').slice(0, 30);
const shownTitle = () => title.textContent.trim() || firstLine();
const showAuto = () => { title.dataset.auto = firstLine() || '제목'; };

async function save() {
  if (empty()) return;
  const t = shownTitle();
  // 사진만 있는 메모는 이름 지을 글이 없다. 저장할 때마다 시각으로 이름이 바뀌지 않게 지금 이름을 둔다.
  current = await memo.save(current, t || current?.replace(/\.html$/i, '') || '', ed.innerHTML, color, !title.textContent.trim());
  memo.setDoc(current, t, color); // 화면 끝 탭도 같이 바뀐다
}

let timer;
const touch = () => {
  clearTimeout(timer);
  timer = setTimeout(save, 500);
  showAuto();
};
ed.addEventListener('input', touch);
title.addEventListener('input', touch);
title.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === 'Escape') && (e.preventDefault(), ed.focus()));

// 제목은 더블클릭해야 고친다. 그냥 누르고 끌면 창이 움직인다.
title.addEventListener('dblclick', () => {
  title.contentEditable = 'true';
  title.focus();
  document.execCommand('selectAll', false, null);
});
title.addEventListener('blur', () => { title.contentEditable = 'false'; });

$('hd').addEventListener('pointerdown', async (e) => {
  if (e.button !== 0 || e.target.closest('button') || title.isContentEditable) return;
  const hd = $('hd'), sx = e.screenX, sy = e.screenY;
  let moved = false;
  const move = (ev) => {
    const dx = ev.screenX - sx, dy = ev.screenY - sy;
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // 더블클릭이 끌기로 먹히지 않게
    if (!moved) hd.setPointerCapture(e.pointerId); // 커서가 창 밖으로 나가도 계속 받는다
    moved = true;
    memo.drag(dx, dy);
  };
  const up = () => {
    hd.removeEventListener('pointermove', move);
    hd.removeEventListener('pointerup', up);
    if (moved) memo.dragEnd();
  };
  hd.addEventListener('pointermove', move);
  hd.addEventListener('pointerup', up);
  await memo.dragStart();
});

// 창을 숨기거나 닫기 전에 남은 글자를 흘리지 않는다
const flush = () => { clearTimeout(timer); return save(); };
document.addEventListener('visibilitychange', () => document.hidden && flush());
addEventListener('beforeunload', flush);
addEventListener('blur', flush);
addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); flush(); } });
addEventListener('contextmenu', (e) => { e.preventDefault(); memo.menu(); });

function show(name, doc) {
  current = name;
  const base = name ? name.replace(/\.html$/i, '') : '';
  // 시각으로 지어진 이름은 제목이 없던 메모다 (자동 제목 전에 만든 메모)
  title.textContent = doc?.auto || /^\d{4}-\d\d-\d\dT/.test(base) ? '' : base;
  ed.innerHTML = doc?.html || '';
  linkify(); // 링크 기능 생기기 전에 적어둔 주소도 열 때 바로 링크가 된다
  setColor(doc?.color || '#fdf07a');
  unselect();
  showAuto();
  memo.setDoc(name, shownTitle(), color);
}

// 새 메모는 지금 포스트잇을 덮어쓰지 않고 새 포스트잇(스티커)으로 뜬다
$('b-new').onclick = async () => {
  await flush();
  memo.newMemo();
};

// ---- 창 ----
// 색은 이름 대신 실제 색 칸으로 고른다
const COLORS = [
  ['노랑', '#fdf07a'],
  ['분홍', '#ffc9d4'],
  ['하늘', '#b8e2ff'],
  ['연두', '#cdf0a7'],
  ['보라', '#ddc9ff'],
  ['주황', '#ffd7a0'],
];
for (const [label, hex] of COLORS) {
  const b = document.createElement('button');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.style.background = hex;
  b.dataset.hex = hex;
  b.onclick = () => {
    setColor(hex);
    $('colors').hidden = true;
    memo.setDoc(current, shownTitle(), hex); // 아직 저장 전인 새 메모도 탭 색이 바뀐다
    flush();
  };
  $('colors').append(b);
}
$('b-color').onclick = (e) => {
  e.stopPropagation();
  $('colors').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.hex === color));
  $('colors').hidden = !$('colors').hidden;
};
addEventListener('click', () => { $('colors').hidden = true; });
addEventListener('blur', () => { $('colors').hidden = true; });
$('b-hide').onclick = async () => { await flush(); memo.hide(); };
// 목록에서 지운 메모. 창이 닫힐 때 다시 저장하지 않게 비워둔다.
memo.onForget(() => {
  clearTimeout(timer);
  current = null;
  title.textContent = ed.innerHTML = '';
});

// 탭에 마우스를 올려 띄운 메모로 넘어와 있는 동안은 닫지 않는다
document.documentElement.addEventListener('mouseenter', () => memo.hover(true));
document.documentElement.addEventListener('mouseleave', () => memo.hover(false));

// ---- 사진 ----
async function insertImage(file) {
  const ext = '.' + (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const url = await memo.saveImage(new Uint8Array(await file.arrayBuffer()), ext);
  document.execCommand('insertHTML', false, `<img src="${url}" style="width:240px">`);
  touch();
}

ed.addEventListener('paste', (e) => {
  const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); insertImage(f); return; }
  // 서식 붙은 글은 서식을 버리고 글자만 넣는다
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
  if (/https?:\/\//i.test(text)) { linkify(); touch(); }
});

// ---- 링크 ----
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,)\]}]/gi;

// 글자 속 주소를 <a> 로 바꾼다. 이미 <a> 안에 있는 건 건드리지 않는다.
function linkify() {
  const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.parentElement.closest('a') && (URL_RE.lastIndex = 0, URL_RE.test(n.nodeValue))) todo.push(n);
  }
  for (const n of todo) {
    const frag = document.createDocumentFragment();
    let at = 0;
    n.nodeValue.replace(URL_RE, (url, i) => {
      if (i > at) frag.append(n.nodeValue.slice(at, i));
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      frag.append(a);
      at = i + url.length;
    });
    if (at < n.nodeValue.length) frag.append(n.nodeValue.slice(at));
    n.replaceWith(frag);
  }
}

// 편집 중에는 커서가 튀지 않게 두고, 손을 뗄 때 정리한다
ed.addEventListener('blur', () => { linkify(); touch(); });

ed.addEventListener('dragover', (e) => e.preventDefault());
// 본문 안의 사진을 끌면 브라우저가 파일처럼 넘겨서, 그대로 두면 새 사진으로 복사된다. 직접 옮긴다.
let dragging = null;
ed.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG') dragging = e.target; });
ed.addEventListener('dragend', () => { dragging = null; });

ed.addEventListener('drop', (e) => {
  if (dragging) {
    e.preventDefault();
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r) r.insertNode(dragging);
    dragging = null;
    place();
    touch();
    return;
  }
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
  if (!f) return; // 글자나 사진 옮기기는 브라우저 기본 동작에 맡긴다
  e.preventDefault();
  const r = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  insertImage(f);
});

function place() {
  if (!sel) return;
  const a = sel.getBoundingClientRect(), b = $('wrap').getBoundingClientRect();
  $('grip').style.left = a.right - b.left - 7 + 'px';
  $('grip').style.top = a.bottom - b.top - 7 + 'px';
  $('tools').style.left = Math.max(2, a.left - b.left) + 'px';
  $('tools').style.top = Math.max(2, a.top - b.top - 30) + 'px';
}

function unselect() {
  sel?.classList.remove('sel');
  sel = null;
  $('grip').hidden = $('tools').hidden = true;
}

ed.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a) { e.preventDefault(); memo.openLink(a.href); return; } // 기본 브라우저로 연다
  unselect();
  if (e.target.tagName !== 'IMG') return;
  sel = e.target;
  sel.classList.add('sel');
  $('grip').hidden = $('tools').hidden = false;
  place();
});
ed.addEventListener('scroll', place);
addEventListener('resize', place);

$('grip').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const img = sel, x0 = e.clientX, w0 = img.getBoundingClientRect().width;
  $('grip').setPointerCapture(e.pointerId);
  const move = (ev) => {
    img.style.width = Math.max(40, w0 + ev.clientX - x0) + 'px';
    img.style.height = 'auto';
    place();
  };
  const up = () => {
    $('grip').removeEventListener('pointermove', move);
    $('grip').removeEventListener('pointerup', up);
    touch();
  };
  $('grip').addEventListener('pointermove', move);
  $('grip').addEventListener('pointerup', up);
});

$('tools').onclick = (e) => {
  const a = e.target.dataset.a;
  if (!a || !sel) return;
  if (a === 'border') sel.style.border = sel.style.border ? '' : '1px solid rgba(0,0,0,.4)';
  if (a === 'reset') { sel.style.width = ''; sel.style.height = ''; }
  if (a === 'del') { sel.remove(); unselect(); }
  place();
  touch();
};

// ---- 시작 ----
async function init() {
  const s = await memo.state();
  if (!s.folder) return;
  const open = new URLSearchParams(location.search).get('open');
  if (!open) return;
  // 다른 PC 나 탐색기에서 그 사이 지워졌을 수도 있다
  try {
    show(open, await memo.read(open));
  } catch {
    show(null, null);
  }
}
memo.onFolderChanged(() => { show(null, null); init(); });
init();
