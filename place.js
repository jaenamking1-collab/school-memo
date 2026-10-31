// 포스트잇을 어디에 둘지 계산한다. electron 없이 돌아가므로 test.js 에서 그대로 시험한다.
const hits = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
exports.hits = hits;

// 시작 칸에서 아래로 내려가며 빈자리를 찾고, 그 줄이 차면 dir 쪽(-1 왼쪽, 1 오른쪽) 옆 줄로 넘어간다.
// 크기가 제각각인 포스트잇도 칸 계산 없이 실제로 겹치는 것만 보고 건너뛴다.
function sweep({ x, y }, size, area, others, dir) {
  const { width: w, height: h, gap } = size;
  const bottom = area.y + area.height;
  const fits = (px) => px >= area.x && px + w <= area.x + area.width;
  for (let top = y; fits(x); top = area.y) {
    for (let py = top; py + h <= bottom; ) {
      const box = { x, y: py, width: w, height: h };
      const on = others.filter((b) => hits(box, b));
      if (!on.length) return box;
      py = Math.max(...on.map((b) => b.y + b.height)) + gap;
    }
    if (top !== area.y) continue; // 시작 줄은 기준 메모 위쪽까지 본 다음에 옆으로 넘어간다
    const col = others.filter((b) => x < b.x + b.width && b.x < x + w);
    x = !col.length ? x + dir * (w + gap)
      : dir < 0 ? Math.min(...col.map((b) => b.x)) - gap - w
      : Math.max(...col.map((b) => b.x + b.width)) + gap;
  }
  return null;
}

// 기준(from) 바로 아래가 첫 자리. 그쪽 방향이 다 차면 반대 방향, 그래도 없으면 조금씩 어긋나게 쌓는다.
exports.freeSpot = (from, size, area, others, dir) => {
  const x = dir < 0 ? from.x + from.width - size.width : from.x;
  const start = {
    x: Math.min(Math.max(x, area.x), area.x + area.width - size.width),
    y: Math.max(from.y + from.height + size.gap, area.y),
  };
  const box = sweep(start, size, area, others, dir) || sweep(start, size, area, others, -dir);
  if (box) return box;
  const n = others.length * 24;
  return {
    x: area.x + area.width - size.width - n % Math.max(24, area.width - size.width),
    y: area.y + n % Math.max(24, area.height - size.height),
    width: size.width,
    height: size.height,
  };
};

// 정렬. at 이 없는 건 아직 저장 전인 새 메모라 최근순 맨 위에 둔다.
exports.sortMemos = (list, order) =>
  [...list].sort((a, b) =>
    order === 'name' ? a.title.localeCompare(b.title, 'ko') : (b.at ?? Infinity) - (a.at ?? Infinity));
