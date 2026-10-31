const $ = (id) => document.getElementById(id);
let data = null;
let inTrash = false;

function row(cls, text, tip) {
  const el = document.createElement('div');
  el.className = 'item' + cls;
  el.title = tip;
  el.innerHTML = '<span class="dot"></span><span class="nm"></span>';
  el.querySelector('.nm').textContent = text;
  return el;
}

function showMemos() {
  const q = $('q').value.trim().toLowerCase();
  // 제목과 본문을 함께 찾는다
  const items = data.items.filter((it) => !q || (it.title + ' ' + it.text).toLowerCase().includes(q));
  $('none').textContent = q ? '찾는 메모가 없습니다.' : '저장된 메모가 없습니다.';
  $('none').hidden = items.length > 0;
  for (const it of items) {
    const el = row(it.open ? ' open' : '', it.title, it.title);
    el.querySelector('.dot').style.background = it.color;
    el.onclick = () => memoList.open(it.name);
    // 지우기는 한 번 더 눌러야 된다. 확인 창을 띄우면 목록 창이 포커스를 잃고 닫힌다.
    const del = document.createElement('button');
    del.title = '휴지통으로';
    del.textContent = '🗑';
    del.onclick = (e) => {
      e.stopPropagation();
      if (del.classList.contains('ask')) memoList.remove(it.name);
      else { del.classList.add('ask'); del.textContent = '지우기'; }
    };
    el.onmouseleave = () => { del.classList.remove('ask'); del.textContent = '🗑'; };
    el.append(del);
    $('items').append(el);
  }
}

function showTrash() {
  $('none').textContent = '휴지통이 비어 있습니다.';
  $('none').hidden = data.trash.length > 0;
  for (const name of data.trash) {
    const title = name.replace(/\.html$/i, '');
    const el = row(' gone', title, '누르면 되살립니다');
    el.onclick = () => memoList.restore(name);
    $('items').append(el);
  }
}

function render() {
  document.body.classList.toggle('right', data.side === 'right');
  document.querySelectorAll('[data-o]').forEach((b) => b.classList.toggle('on', b.dataset.o === data.order));
  $('main').hidden = inTrash;
  $('head').textContent = inTrash ? '휴지통' : '메모 목록';
  $('trash').textContent = inTrash ? '← 메모 목록' : `휴지통 (${data.trash.length})`;
  $('items').innerHTML = '';
  if (inTrash) showTrash();
  else showMemos();
}

const take = (d) => { data = d; render(); };
document.querySelectorAll('[data-o]').forEach((b) => { b.onclick = () => memoList.order(b.dataset.o); });
$('new').onclick = () => memoList.newMemo();
$('q').oninput = render;
$('folder').onclick = () => memoList.folder();
$('trash').onclick = () => { inTrash = !inTrash; render(); };
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('q').value) { $('q').value = ''; render(); } // 검색어가 있으면 그것부터 지운다
  else close();
});
memoList.onData(take);
memoList.data().then(take);
$('q').focus();
