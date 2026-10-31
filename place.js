// 포스트잇을 어디에 둘지 계산한다. electron 없이 돌아가므로 test.js 에서 그대로 시험한다.
const hits = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
exports.hits = hits;

// 방향별 벌점(px). 조금 더 멀어도 아래를 먼저 쓰고, 그다음 펼칠 방향, 위, 반대 방향 순이다.
const SIDE = { below: 0, toward: 40, above: 80, away: 120 };

function score(box, from, dir) {
  const fromRight = from.x + from.width, fromBottom = from.y + from.height;
  const gapX = Math.max(0, from.x - (box.x + box.width), box.x - fromRight);
  const gapY = Math.max(0, from.y - (box.y + box.height), box.y - fromBottom);
  const isLeft = box.x + box.width <= from.x, isRight = box.x >= fromRight;
  const side = box.y >= fromBottom ? 'below'
    : (dir < 0 ? isLeft : isRight) ? 'toward'
    : box.y + box.height <= from.y ? 'above'
    : 'away';
  // 거리가 같으면 기준 메모와 줄이 맞는 자리가 이긴다
  const center = Math.abs(box.x + box.width / 2 - (from.x + from.width / 2)) + Math.abs(box.y + box.height / 2 - (from.y + from.height / 2));
  return gapX + gapY + SIDE[side] + center * 0.01;
}

// 기준(from)에서 가장 가까운 빈자리. 다른 메모의 네 변에 딱 붙는 자리만 후보로 본다.
// 크기가 제각각이어도 그대로 되고, 위에서부터 훑지 않으니 멀리 튀지 않는다.
exports.freeSpot = (from, size, area, others, dir) => {
  const { width: w, height: h, gap } = size;
  const right = area.x + area.width - w, bottom = area.y + area.height - h;
  const xs = [area.x, right], ys = [area.y, bottom];
  for (const o of [from, ...others]) {
    xs.push(o.x, o.x + o.width - w, o.x - w - gap, o.x + o.width + gap);
    ys.push(o.y, o.y + o.height - h, o.y - h - gap, o.y + o.height + gap);
  }
  let best = null, bestScore = Infinity;
  for (const x of xs) {
    if (x < area.x || x > right) continue;
    for (const y of ys) {
      if (y < area.y || y > bottom) continue;
      const box = { x, y, width: w, height: h };
      if (others.some((o) => hits(box, o))) continue;
      const s = score(box, from, dir);
      if (s < bestScore) { best = box; bestScore = s; }
    }
  }
  if (best) return best;
  // 화면이 정말 꽉 찼다. 똑같은 자리에 포개지 않게 조금씩 어긋나게 쌓는다.
  const n = others.length * 24;
  return {
    x: right - n % Math.max(24, area.width - w),
    y: area.y + n % Math.max(24, area.height - h),
    width: w,
    height: h,
  };
};

// 정렬한 순서대로 위에서 아래로 쌓고, 줄이 차면 옆 줄로 넘어간다.
// 메모마다 벽(edge) 쪽으로 닿을 때까지 밀어 붙여서, 크기가 달라도 틈이 남지 않는다.
exports.stackBoxes = (sizes, area, edge, dir, gap) => {
  const placed = [];
  let y = area.y;
  for (const { width, height } of sizes) {
    if (y > area.y && y + height > area.y + area.height) y = area.y;
    const row = placed.filter((b) => y < b.y + b.height && b.y < y + height);
    const x = dir < 0
      ? Math.min(edge, ...row.map((b) => b.x - gap)) - width
      : Math.max(edge, ...row.map((b) => b.x + b.width + gap));
    placed.push({ x: Math.min(Math.max(x, area.x), area.x + area.width - width), y, width, height });
    y += height + gap;
  }
  return placed;
};

// 벽(목록 창)에 가리는 메모만 dir 쪽으로 비킨다. 위아래로 비껴 있는 메모는 그대로 둔다.
// 비킨 메모가 옆 메모에 닿으면 그 메모도 이어서 밀린다.
exports.pushBoxes = (boxes, wall, dir, gap) => {
  const near = (b) => (dir < 0 ? -(b.x + b.width) : b.x);
  const order = boxes.map((_, i) => i).sort((p, q) => near(boxes[p]) - near(boxes[q]));
  const walls = [wall];
  const out = boxes.map((b) => ({ ...b }));
  for (const i of order) {
    const b = boxes[i];
    const on = walls.filter((w) => b.y < w.y + w.height && w.y < b.y + b.height
      && (dir < 0 ? b.x < w.x + w.width && b.x + b.width + gap > w.x : b.x + b.width > w.x && b.x - gap < w.x + w.width));
    if (!on.length) continue;
    out[i].x = dir < 0 ? Math.min(...on.map((w) => w.x)) - gap - b.width : Math.max(...on.map((w) => w.x + w.width)) + gap;
    walls.push(out[i]);
  }
  return out;
};

// 메모 하나의 크기가 old 에서 next 로 바뀌었을 때 주변 메모의 새 자리.
// 아래 메모는 높이 차만큼, 펼칠 방향 옆 메모는 너비 차만큼 따라 움직이고,
// 그래도 겹치거나 화면을 벗어나는 메모는 가장 가까운 빈자리로 간다.
exports.reflow = (others, old, next, dir, gap, area, fixed = []) => {
  const dw = next.width - old.width, dh = next.height - old.height;
  const oldRight = old.x + old.width, oldBottom = old.y + old.height;
  const underIt = (b) => b.x < Math.max(oldRight, next.x + next.width) && Math.min(old.x, next.x) < b.x + b.width;
  const besideIt = (b) => b.y < oldBottom && old.y < b.y + b.height;
  const moved = others.map((b) => {
    if (b.y >= oldBottom && underIt(b)) return { ...b, y: b.y + dh };
    if (besideIt(b) && (dir < 0 ? b.x + b.width <= old.x : b.x >= oldRight)) return { ...b, x: b.x + dir * dw };
    return { ...b };
  });
  const placed = [next, ...fixed];
  const inArea = (b) => b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height;
  const free = (b) => inArea(b) && !placed.some((o) => hits(b, o));
  return moved.map((b, i) => {
    // 따라갈 자리가 막히면 멀리 튀지 않고 원래 자리에 그대로 있는다
    const box = free(b) ? b : free(others[i]) ? { ...others[i] } : exports.freeSpot(b, { width: b.width, height: b.height, gap }, area, placed, dir);
    placed.push(box);
    return box;
  });
};

// 끌고 있는 메모가 가까이 오면 다른 메모·화면 끝에 붙는다.
// 옆이나 위아래로 닿을 때는 gap 만큼 띄우고, 위아래로 이웃한 메모와는 끝선도 맞춘다.
exports.snapMove = (box, others, area, gap, reach) => {
  const { x, y, width: w, height: h } = box;
  const pick = (now, list) => list.reduce((best, v) => (Math.abs(v - now) < Math.abs(best - now) ? v : best), list[0] ?? now);
  const closeX = [area.x, area.x + area.width - w].filter((v) => Math.abs(v - x) <= reach);
  const closeY = [area.y, area.y + area.height - h].filter((v) => Math.abs(v - y) <= reach);
  for (const o of others) {
    const right = o.x + o.width, bottom = o.y + o.height;
    const nearRow = y < bottom + gap + reach && o.y < y + h + gap + reach; // 세로로 닿을 만큼 가깝다
    const nearCol = x < right + gap + reach && o.x < x + w + gap + reach; // 가로로 닿을 만큼 가깝다
    if (nearRow) closeX.push(o.x - w - gap, right + gap);
    if (nearCol) closeY.push(o.y - h - gap, bottom + gap);
    if (nearRow && nearCol) {
      closeX.push(o.x, right - w);
      closeY.push(o.y, bottom - h);
    }
  }
  const near = (list, now) => list.filter((v) => Math.abs(v - now) <= reach);
  return { x: pick(x, near(closeX, x)), y: pick(y, near(closeY, y)) };
};

// 탭 줄이 from 에서 to 로 옮겨 갈 때 메모의 새 자리. 탭 줄에서 떨어진 거리를 그대로 지킨다.
// 화면을 건너가 방향이 바뀌면 탭 줄 반대쪽으로 뒤집힌다. 이동 거리로 밀면 옆 모니터로 넘어갈 때
// 실제로는 몇십 px 차이뿐이라 메모가 옛 화면에 남는다.
exports.followDock = (b, from, to, fromDir, toDir, area) => {
  const dist = fromDir < 0 ? from.x - (b.x + b.width) : b.x - (from.x + from.width);
  const x = toDir < 0 ? to.x - dist - b.width : to.x + to.width + dist;
  const y = b.y + to.y - from.y;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - b.width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - b.height),
    width: b.width,
    height: b.height,
  };
};

// 왼쪽 위부터 차곡차곡. 왼쪽에서 오른쪽으로 놓고, 줄이 차면 다음 줄로 간다.
// 메모마다 바로 위 메모에 닿는 높이까지 올라가므로 크기가 달라도 틈이 남지 않는다.
exports.rowBoxes = (sizes, area, gap) => {
  const placed = [];
  let x = area.x;
  for (const { width, height } of sizes) {
    if (x > area.x && x + width > area.x + area.width) x = area.x;
    const above = placed.filter((b) => x < b.x + b.width && b.x < x + width);
    const y = Math.max(area.y, ...above.map((b) => b.y + b.height + gap));
    placed.push({ x, y: Math.min(y, Math.max(area.y, area.y + area.height - height)), width, height });
    x += width + gap;
  }
  return placed;
};

// 정렬. at 이 없는 건 아직 저장 전인 새 메모라 최근순 맨 위에 둔다.
exports.sortMemos = (list, order) =>
  [...list].sort((a, b) =>
    order === 'name' ? a.title.localeCompare(b.title, 'ko') : (b.at ?? Infinity) - (a.at ?? Infinity));
