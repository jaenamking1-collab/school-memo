const $ = (id) => document.getElementById(id);

function render({ order, side, items }) {
  document.body.classList.toggle('right', side === 'right');
  document.querySelectorAll('[data-o]').forEach((b) => b.classList.toggle('on', b.dataset.o === order));
  $('none').hidden = items.length > 0;
  $('items').innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'item' + (it.open ? ' open' : '');
    row.title = it.title;
    row.innerHTML = '<span class="dot"></span><span class="nm"></span><button title="삭제">🗑</button>';
    row.querySelector('.dot').style.background = it.color;
    row.querySelector('.nm').textContent = it.title;
    row.onclick = () => memoList.open(it.name);
    // 지우기는 한 번 더 눌러야 된다. 확인 창을 띄우면 목록 창이 포커스를 잃고 닫힌다.
    const del = row.querySelector('button');
    del.onclick = (e) => {
      e.stopPropagation();
      if (del.classList.contains('ask')) memoList.remove(it.name);
      else { del.classList.add('ask'); del.textContent = '지우기'; }
    };
    row.onmouseleave = () => { del.classList.remove('ask'); del.textContent = '🗑'; };
    $('items').append(row);
  }
}

document.querySelectorAll('[data-o]').forEach((b) => { b.onclick = () => memoList.order(b.dataset.o); });
$('new').onclick = () => memoList.newMemo();
addEventListener('keydown', (e) => e.key === 'Escape' && close());
memoList.onData(render);
memoList.data().then(render);
