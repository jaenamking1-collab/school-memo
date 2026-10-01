const $ = (id) => document.getElementById(id);
const ed = $('ed'), title = $('title'), items = $('items');
let current = null; // 지금 열린 파일명. 새 메모면 null
let color = '#fdf07a';
let sel = null; // 고른 사진

const setColor = (hex) => {
  color = hex;
  document.documentElement.style.setProperty('--bg', hex);
};

// ---- 저장 ----
const empty = () => !title.textContent.trim() && !ed.textContent.trim() && !ed.querySelector('img');

async function save() {
  if (empty()) return;
  current = await memo.save(current, title.textContent, ed.innerHTML, color);
  memo.setDoc(current, title.textContent.trim(), color); // 화면 끝 탭도 같이 바뀐다
}

let timer;
const touch = () => {
  clearTimeout(timer);
  timer = setTimeout(save, 500);
};
ed.addEventListener('input', touch);
title.addEventListener('input', touch);
title.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), ed.focus()));

// 창을 숨기거나 닫기 전에 남은 글자를 흘리지 않는다
const flush = () => { clearTimeout(timer); return save(); };
document.addEventListener('visibilitychange', () => document.hidden && flush());
addEventListener('beforeunload', flush);
addEventListener('blur', flush);
addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); flush(); } });
addEventListener('contextmenu', (e) => { e.preventDefault(); memo.menu(); });

memo.onColor((hex) => { setColor(hex); flush(); });

function show(name, doc) {
  current = name;
  title.textContent = name ? name.replace(/\.html$/i, '') : '';
  ed.innerHTML = doc?.html || '';
  linkify(); // 링크 기능 생기기 전에 적어둔 주소도 열 때 바로 링크가 된다
  setColor(doc?.color || '#fdf07a');
  unselect();
  memo.setDoc(name, title.textContent, color);
}

function closePanel() {
  $('panel').hidden = true;
  $('b-list').classList.remove('on');
}

// ---- 목록 ----
async function refresh() {
  const names = await memo.list();
  items.innerHTML = '';
  for (const n of names) {
    const row = document.createElement('div');
    row.className = 'item' + (n === current ? ' on' : '');
    row.innerHTML = '<span class="nm"></span><button title="이름 바꾸기">✎</button><button title="삭제">🗑</button>';
    const nm = row.querySelector('.nm');
    nm.textContent = n.replace(/\.html$/i, '');
    row.onclick = async () => {
      if (nm.isContentEditable) return;
      if (n === current) return closePanel();
      await flush();
      // 다른 포스트잇이 이미 그 메모를 열어뒀으면 그 창을 꺼낸다
      if (!(await memo.claim(n))) return closePanel();
      show(n, await memo.read(n));
      closePanel(); // 제목을 누르면 바로 편집 화면으로
    };
    row.querySelectorAll('button')[0].onclick = (e) => { e.stopPropagation(); startRename(nm, n); };
    nm.ondblclick = (e) => { e.stopPropagation(); startRename(nm, n); };
    row.querySelectorAll('button')[1].onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(nm.textContent + ' 을(를) 지울까요?')) return;
      await memo.remove(n);
      if (n === current) show(null, null);
      refresh();
    };
    items.append(row);
  }
}

function startRename(nm, n) {
  const before = nm.textContent;
  nm.contentEditable = 'true';
  nm.focus();
  document.execCommand('selectAll', false, null);
  const done = async (ok) => {
    nm.contentEditable = 'false';
    const next = nm.textContent.trim();
    if (!ok || !next || next === before) { nm.textContent = before; return; }
    const saved = await memo.rename(n, next);
    if (n === current) { current = saved; title.textContent = next; memo.setDoc(saved, next, color); }
    refresh();
  };
  nm.onblur = () => done(true);
  nm.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nm.blur(); }
    if (e.key === 'Escape') { nm.onblur = null; done(false); nm.blur(); }
  };
}

$('b-list').onclick = async () => {
  const p = $('panel');
  if (!p.hidden) return closePanel();
  await flush();
  await refresh();
  p.hidden = false;
  $('b-list').classList.add('on');
};
// 새 메모는 지금 포스트잇을 덮어쓰지 않고 새 포스트잇(스티커)으로 뜬다
$('b-new').onclick = async () => {
  await flush();
  closePanel();
  memo.newMemo();
};

// ---- 창 ----
$('b-color').onclick = () => memo.colorMenu();
$('b-hide').onclick = async () => { await flush(); memo.hide(); };
$('b-pin').onclick = async () => {
  const v = await memo.pin(!$('b-pin').classList.contains('on'));
  $('b-pin').classList.toggle('on', v);
};

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
ed.addEventListener('drop', (e) => {
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
  $('b-pin').classList.toggle('on', s.pinned);
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
