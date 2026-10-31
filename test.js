const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fileNameFor = require('./name');
const store = require('./store');
const { freeSpot, stackBoxes, pushBoxes, reflow, snapMove, followDock, rowBoxes, sortMemos } = require('./place');

// ---- 제목 -> 파일명 ----
assert.equal(fileNameFor('회의록'), '회의록.html');
assert.equal(fileNameFor('a/b:c*d?'), 'abcd.html');
assert.equal(fileNameFor('a\\b'), 'ab.html'); // 백슬래시도 걷어내야 한다
assert.equal(fileNameFor('  띄어  쓰기  '), '띄어 쓰기.html');
assert.equal(fileNameFor('끝점...'), '끝점.html');
assert.equal(fileNameFor('가'.repeat(100)), '가'.repeat(60) + '.html');
assert.match(fileNameFor('///'), /^\d{4}-.*\.html$/); // 남는 글자가 없으면 시각
assert.match(fileNameFor(''), /^\d{4}-.*\.html$/);

// ---- 메모 폴더 ----
const f = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-'));

// 남의 파일은 건드리지 않는다
fs.writeFileSync(path.join(f, 'index.html'), '<html>남의 파일</html>');
fs.writeFileSync(path.join(f, '메모.md'), '옛날 메모');
assert.deepEqual(store.list(f), []);

// 저장하고 다시 읽으면 그대로 나온다
const a = store.save(f, null, '장보기', '<div>우유</div>');
assert.equal(a, '장보기.html');
assert.equal(store.read(f, a).html, '<div>우유</div>');
assert.deepEqual(store.list(f), ['장보기.html']);
assert.ok(fs.readFileSync(path.join(f, a), 'utf8').startsWith(store.MARK));

// 제목을 바꾸면 파일 이름도 따라 바뀌고, 내용은 남는다
const b = store.save(f, a, '주말 장보기', '<div>우유<br>빵</div>');
assert.equal(b, '주말 장보기.html');
assert.ok(!fs.existsSync(path.join(f, a)));
assert.equal(store.read(f, b).html, '<div>우유<br>빵</div>');

// 남의 파일 이름과 겹쳐도 덮어쓰지 않는다
const c = store.save(f, null, 'index', '<div>내 메모</div>');
assert.equal(c, 'index (2).html');
assert.equal(fs.readFileSync(path.join(f, 'index.html'), 'utf8'), '<html>남의 파일</html>');

// 메모끼리 이름이 겹쳐도 덮어쓰지 않는다
const d = store.save(f, null, '주말 장보기', '<div>다른 메모</div>');
assert.equal(d, '주말 장보기 (2).html');
assert.equal(store.read(f, b).html, '<div>우유<br>빵</div>');

// 목록에서 이름 바꾸기
const e = store.rename(f, d, '딴 메모');
assert.equal(e, '딴 메모.html');
assert.equal(store.read(f, e).html, '<div>다른 메모</div>');

// 포스트잇 색은 메모 파일 안에 적힌다 (다른 PC 에서도 따라온다)
assert.equal(store.read(f, e).color, store.DEFAULT_COLOR);
const col = store.save(f, e, '딴 메모', '<div>다른 메모</div>', '#b5e2ff');
assert.equal(store.read(f, col).color, '#b5e2ff');
assert.equal(store.read(f, col).html, '<div>다른 메모</div>');

// 색이 없던 옛날 파일도 그대로 읽힌다
fs.writeFileSync(path.join(f, '옛날.html'), '<!--memo-->\n<div>옛날</div>');
assert.ok(store.list(f).includes('옛날.html'));
assert.equal(store.read(f, '옛날.html').html, '<div>옛날</div>');
assert.equal(store.read(f, '옛날.html').color, store.DEFAULT_COLOR);

// 제목 없이 본문 첫 글로 이름을 지은 메모는 다시 열어도 그 표시가 남는다
const au = store.save(f, null, '첫 줄', '<div>첫 줄</div>', store.DEFAULT_COLOR, true);
assert.equal(store.read(f, au).auto, true);
assert.equal(store.read(f, b).auto, false);
store.remove(f, au);

// 사진: 파일에는 상대경로, 화면에는 절대 file:// 주소
const url = store.saveImage(f, Buffer.from([1, 2, 3]), '.png');
assert.ok(url.startsWith('file:///') && url.endsWith('.png'));
assert.equal(fs.readdirSync(path.join(f, 'assets')).length, 1);
const g = store.save(f, null, '사진메모', `<img src="${url}" style="width:240px">`);
assert.match(fs.readFileSync(path.join(f, g), 'utf8'), /src="assets\/\d+-\w+\.png"/);
assert.equal(store.read(f, g).html, `<img src="${url}" style="width:240px">`);

// 화면이 넘긴 이름으로 메모 폴더 밖을 건드릴 수 없다
const outside = path.join(path.dirname(f), 'memo-outside.html');
fs.writeFileSync(outside, store.MARK + '-->\n<div>밖</div>');
for (const bad of ['../memo-outside.html', '..\\memo-outside.html', outside, '..', 'x.txt', null]) {
  assert.throws(() => store.read(f, bad), /잘못된 메모 이름/);
  assert.throws(() => store.remove(f, bad), /잘못된 메모 이름/);
  assert.throws(() => store.rename(f, bad, '새이름'), /잘못된 메모 이름/);
}
assert.throws(() => store.save(f, '../memo-outside.html', '제목', '<div>덮어쓰기</div>'), /잘못된 메모 이름/);
assert.ok(fs.existsSync(outside));
assert.equal(fs.readFileSync(outside, 'utf8'), store.MARK + '-->\n<div>밖</div>');
fs.rmSync(outside);

// 메모가 아닌 파일은 이름이 .html 이어도 지우지 않는다
store.remove(f, 'index.html');
assert.ok(fs.existsSync(path.join(f, 'index.html')));

// 사진 확장자는 사진만
for (const bad of ['.exe', '.html', '/../x.png', '', null]) {
  assert.throws(() => store.saveImage(f, Buffer.from([1]), bad), /사진 파일이 아니다/);
}

// 색 칸에 이상한 값이 오면 기본색으로 적는다 (첫 줄 주석을 깨뜨리지 못한다)
const h = store.save(f, null, '색주입', '<div>x</div>', '#fff--><script>');
assert.equal(fs.readFileSync(path.join(f, h), 'utf8').split('\n')[0], `${store.MARK} color=${store.DEFAULT_COLOR}-->`);

// 삭제는 휴지통으로 옮기기다. 되살리면 내용이 그대로 돌아온다.
const keep = store.read(f, col).html;
store.remove(f, col);
assert.ok(!store.list(f).includes(col));
assert.ok(store.listTrash(f).includes(col));
const same = store.save(f, null, '딴 메모', '<div>새로 만든 같은 이름</div>');
const back = store.restore(f, col);
assert.equal(back, '딴 메모 (2).html'); // 같은 이름이 있어도 덮어쓰지 않는다
assert.equal(store.read(f, back).html, keep);
assert.equal(store.read(f, same).html, '<div>새로 만든 같은 이름</div>');
assert.ok(!store.listTrash(f).includes(col));
assert.throws(() => store.restore(f, '../memo-outside.html'), /잘못된 메모 이름/);

// 스크린샷은 저장 폴더 아래 스크린샷 폴더에 찍은 시각 이름으로 들어간다
const sf = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-shot-'));
const shotUrl = store.saveShot(sf, Buffer.from([1, 2]), new Date(2026, 9, 31, 19, 5, 7));
const shotFiles = fs.readdirSync(path.join(sf, '스크린샷'));
assert.match(shotFiles[0], /^2026-10-31_19-05-07-\w+\.png$/);
const sm = store.save(sf, null, '찍은것', `<img src="${shotUrl}">`);
assert.match(fs.readFileSync(path.join(sf, sm), 'utf8'), /src="스크린샷\/2026-10-31_19-05-07-\w+\.png"/); // 파일에는 상대 주소
assert.equal(store.read(sf, sm).html, `<img src="${shotUrl}">`);
const sf2 = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-shot2-'));
store.moveAll(sf, sf2); // 폴더를 옮겨도 스크린샷이 따라간다
assert.deepEqual(fs.readdirSync(path.join(sf2, '스크린샷')), shotFiles);
assert.ok(!fs.existsSync(path.join(sf, '스크린샷')));
assert.match(store.read(sf2, sm).html, /memo-shot2-.*\.png/);
fs.rmSync(sf, { recursive: true, force: true });
fs.rmSync(sf2, { recursive: true, force: true });

// 저장 폴더 옮기기
const mv = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-mv-'));
const src = path.join(mv, 'a'), dst = path.join(mv, 'b');
fs.mkdirSync(src);
fs.mkdirSync(dst);
fs.writeFileSync(path.join(src, '남의파일.txt'), '그대로');
const pic = store.saveImage(src, Buffer.from([1, 2, 3]), '.png');
const m1 = store.save(src, null, '겹침', `<img src="${pic}">`);
const m2 = store.save(src, null, '버릴것', '<div>휴지통</div>');
store.remove(src, m2);
store.save(dst, null, '겹침', '<div>원래 있던 메모</div>');
const moved = store.moveAll(src, dst);
assert.deepEqual(moved, { '겹침.html': '겹침 (2).html' });
assert.deepEqual(store.list(src), []);
assert.deepEqual(store.listTrash(src), []);
assert.deepEqual(store.listTrash(dst), ['버릴것.html']);
assert.equal(store.read(dst, '겹침.html').html, '<div>원래 있던 메모</div>'); // 덮어쓰지 않았다
assert.match(store.read(dst, '겹침 (2).html').html, /src="file:.*\/b\/assets\//); // 사진 주소가 새 폴더를 본다
assert.equal(fs.readdirSync(path.join(dst, 'assets')).length, 1);
assert.ok(!fs.existsSync(path.join(src, 'assets')));
assert.ok(fs.existsSync(path.join(src, '남의파일.txt'))); // 메모가 아닌 파일은 두고 간다
assert.throws(() => store.moveAll(src, src), /옮길 수 없습니다/);
assert.throws(() => store.moveAll(src, path.join(src, '안쪽')), /옮길 수 없습니다/);
// 복사하다 실패하면 원본이 그대로 남고 새 폴더도 깨끗하다
const m3 = store.save(src, null, '안전', '<div>x</div>');
const blocked = path.join(mv, 'c');
fs.mkdirSync(blocked);
fs.writeFileSync(path.join(blocked, 'assets'), '폴더 자리에 파일이 있어 사진 복사가 실패한다');
store.saveImage(src, Buffer.from([9]), '.png');
assert.throws(() => store.moveAll(src, blocked));
assert.deepEqual(store.list(src), [m3]);
assert.deepEqual(store.list(blocked), []);
fs.rmSync(mv, { recursive: true, force: true });

fs.rmSync(f, { recursive: true, force: true });

// ---- 새 포스트잇 자리 ----
const area = { x: 0, y: 0, width: 1000, height: 700 };
const size = { width: 270, height: 215, gap: 4 };
const box = (x, y, w = 270, h = 215) => ({ x, y, width: w, height: h });
const overlap = (a, list) => list.some((o) => a.x < o.x + o.width && o.x < a.x + a.width && a.y < o.y + o.height && o.y < a.y + a.height);

// 기준 메모 바로 아래가 첫 자리
assert.deepEqual(freeSpot(box(700, 10), size, area, [box(700, 10)], -1), box(700, 229));
// 아래가 다 찼으면 맨 위로 튀지 않고 바로 옆에 붙는다
let wall = [box(700, 10), box(700, 229), box(700, 448)];
assert.deepEqual(freeSpot(wall[2], size, area, wall, -1), box(426, 448));
// 왼쪽 벽에 붙어 있으면 오른쪽으로 간다
wall = [box(0, 10), box(0, 229), box(0, 448)];
assert.deepEqual(freeSpot(wall[2], size, area, wall, 1), box(274, 448));
// 스샷3: 크기가 다른 메모가 쌓여 있어도 저 멀리 가지 않고 맞닿은 곳에 나온다
wall = [box(650, 0, 340, 240), box(650, 330, 340, 260), box(300, 600 - 500, 346, 500)];
const near = freeSpot(wall[2], size, area, wall, -1);
assert.ok(!overlap(near, wall));
assert.ok(near.x + near.width >= 300 - 8 && near.x <= 650, JSON.stringify(near));
// 크기가 제각각이어도 겹치지 않는다 (스샷: 넓은 메모 4개 + 새 메모)
wall = [box(20, 25, 238, 215), box(260, 25, 238, 215), box(500, 25, 238, 215), box(740, 25, 238, 215)];
assert.ok(!overlap(freeSpot(wall[3], size, area, wall, -1), wall));
// 화면이 정말 꽉 차도 앞 메모와 똑같은 자리에 포개지 않는다
const full = freeSpot(box(0, 0), size, area, [box(0, 0, 1000, 700)], -1);
assert.notDeepEqual([full.x, full.y], [0, 0]);

// 정렬해서 쌓기: 크기가 달라도 겹치지 않고 벽 쪽으로 붙는다
const wide = { x: 0, y: 0, width: 1400, height: 700 };
const sizes = [box(0, 0, 340, 300), box(0, 0, 500, 300), box(0, 0, 270, 215), box(0, 0, 270, 215)];
const st = stackBoxes(sizes, wide, 1400, -1, 4);
st.forEach((a, i) => assert.ok(!overlap(a, st.filter((_, j) => j !== i)), 'stack ' + i));
assert.equal(st[0].x + st[0].width, 1400);
assert.equal(st[1].x + st[1].width, 1400);
assert.equal(st[2].y, 0); // 줄이 차면 맨 위로
assert.equal(st[2].x + st[2].width, st[0].x - 4); // 좁은 메모 옆에 틈 없이 붙는다
assert.ok(stackBoxes(sizes, wide, 0, 1, 4).every((b) => b.x >= 0));

// 목록이 열리면 가리는 메모와 그 옆으로 이어지는 메모만 비킨다
const list = { x: 700, y: 200, width: 250, height: 400 };
const pm = [box(720, 0, 270, 190), box(720, 300), box(440, 300), box(-200, 300), box(720, 610, 270, 90)];
const pushed = pushBoxes(pm, list, -1, 4);
assert.deepEqual(pushed[0], pm[0]); // 위
assert.deepEqual(pushed[4], pm[4]); // 아래
assert.equal(pushed[1].x, 426); // 가리던 메모
assert.equal(pushed[2].x, 152); // 밀려서 닿은 옆 메모
assert.equal(pushed[3].x, -200); // 아직 안 닿은 메모
assert.equal(pushBoxes([box(100, 300)], { ...list, x: 50 }, 1, 4)[0].x, 304); // 오른쪽으로 펼칠 때

// 크기가 바뀌면 주변이 따라 움직인다
const tall = { x: 0, y: 0, width: 1000, height: 1000 };
const was = box(700, 0, 270, 300);
const round = (l) => l.map((b) => [b.x, b.y]);
// 커지면 아래 메모는 내려가고 옆 메모는 밀려난다. 겹치지 않는다.
let grown = box(600, 0, 370, 500);
let rf = reflow([box(700, 304), box(426, 0), box(100, 600)], was, grown, -1, 4, tall);
assert.deepEqual(round(rf), [[700, 504], [326, 0], [100, 600]]);
assert.ok(!rf.some((b) => overlap(b, [grown])));
// 작아지면 틈을 메운다
grown = box(800, 0, 170, 100);
rf = reflow([box(700, 304), box(426, 0)], was, grown, -1, 4, tall);
assert.deepEqual(round(rf), [[700, 104], [426, 0]]); // 옆 메모는 위 메모가 올라온 자리에 막혀 그대로
rf = reflow([box(426, 0)], was, grown, -1, 4, tall);
assert.deepEqual(round(rf), [[526, 0]]); // 막히지 않으면 따라온다
// 밀려서 화면 밖으로 나가면 빈자리로 간다
grown = box(600, 0, 370, 800);
rf = reflow([box(700, 304), box(700, 523)], was, grown, -1, 4, tall);
assert.ok(rf.every((b) => b.y + b.height <= 1000 && b.x >= 0 && !overlap(b, [grown])));
assert.ok(!overlap(rf[0], [rf[1]]));

// 끌 때 자석처럼 붙기
const scr = { x: 0, y: 44, width: 1000, height: 700 };
const fix = box(500, 300);
// 메모 왼쪽에 가까이 오면 틈 4 를 두고 붙고, 줄 높이도 맞는다
assert.deepEqual(snapMove(box(220, 305), [fix], scr, 4, 12), { x: 226, y: 300 });
// 메모 아래로 오면 왼쪽 끝선이 맞는다
assert.deepEqual(snapMove(box(506, 525), [fix], { ...scr, height: 900 }, 4, 12), { x: 500, y: 519 });
// 화면 끝
assert.deepEqual(snapMove(box(5, 50), [], scr, 4, 12), { x: 0, y: 44 });
assert.deepEqual(snapMove(box(725, 400), [], scr, 4, 12), { x: 730, y: 400 });
// 멀면 그대로
assert.deepEqual(snapMove(box(100, 100), [fix], scr, 4, 12), { x: 100, y: 100 });
// 줄이 다르게 멀리 있는 메모의 옆줄에는 붙지 않는다
assert.deepEqual(snapMove(box(226, 80), [box(500, 600)], scr, 4, 12), { x: 226, y: 80 });

// 탭 줄을 옆 화면으로 옮기면 메모가 따라가고 방향이 뒤집힌다
const dockA = box(1986, 300, 62, 200), dockB = box(2048, 300, 62, 200);
const right = { x: 2048, y: 44, width: 1500, height: 900 };
assert.deepEqual(followDock(box(1700, 100), dockA, dockB, -1, 1, right), box(2110 + 16, 100));
// 같은 화면에서 옮기면 거리와 높이만 그대로 따라온다
assert.deepEqual(followDock(box(1700, 100), dockA, { ...dockA, y: 500 }, -1, -1, { x: 0, y: 44, width: 2048, height: 1000 }), box(1700, 300));
// 화면 밖으로 나가면 안으로 들어온다
assert.equal(followDock(box(1700, 100), dockA, { ...dockA, y: 1100 }, -1, -1, { x: 0, y: 44, width: 2048, height: 1000 }).y, 829);

// 왼쪽 위부터 차곡차곡
const rowArea = { x: 100, y: 44, width: 912, height: 800 };
const rows = rowBoxes([box(0, 0, 300, 200), box(0, 0, 300, 400), box(0, 0, 300, 200), box(0, 0, 300, 100), box(0, 0, 300, 100)], rowArea, 4);
assert.deepEqual([rows[0].x, rows[0].y], [100, 44]); // 맨 앞은 왼쪽 위
assert.deepEqual([rows[1].x, rows[1].y], [404, 44]); // 오른쪽으로
assert.deepEqual([rows[2].x, rows[2].y], [708, 44]);
assert.deepEqual([rows[3].x, rows[3].y], [100, 248]); // 줄이 차면 왼쪽으로 돌아와 위 메모에 붙는다
assert.deepEqual([rows[4].x, rows[4].y], [404, 448]); // 위 메모가 길면 그 아래에
rows.forEach((a, i) => assert.ok(!overlap(a, rows.filter((_, j) => j !== i)), 'row ' + i));

// 정렬
const ms = [{ title: '다', at: 1 }, { title: '가', at: 3 }, { title: '나' }];
assert.deepEqual(sortMemos(ms, 'name').map((x) => x.title), ['가', '나', '다']);
assert.deepEqual(sortMemos(ms, 'recent').map((x) => x.title), ['나', '가', '다']);

console.log('ok');
