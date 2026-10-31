const box = document.getElementById('box'), dim = document.getElementById('dim'), hint = document.getElementById('hint');
let start = null, rect = null;

shot.image().then((url) => { document.getElementById('bg').src = url; });

addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return shot.done(null); // 오른쪽 클릭도 취소
  start = { x: e.clientX, y: e.clientY };
  document.documentElement.setPointerCapture(e.pointerId);
  dim.style.display = hint.style.display = 'none';
  box.style.display = 'block';
});

addEventListener('pointermove', (e) => {
  if (!start) return;
  rect = {
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y),
  };
  box.style.left = rect.x + 'px';
  box.style.top = rect.y + 'px';
  box.style.width = rect.width + 'px';
  box.style.height = rect.height + 'px';
});

addEventListener('pointerup', () => {
  if (start) shot.done(rect && rect.width > 4 && rect.height > 4 ? rect : null); // 그냥 누른 건 취소
});

addEventListener('keydown', (e) => e.key === 'Escape' && shot.done(null));
