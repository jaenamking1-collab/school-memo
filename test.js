const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fileNameFor = require('./name');
const store = require('./store');

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

// 삭제
store.remove(f, col);
assert.ok(!store.list(f).includes(col));

fs.rmSync(f, { recursive: true, force: true });
console.log('ok');
