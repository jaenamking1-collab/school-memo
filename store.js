// 메모 폴더에 파일을 읽고 쓰는 부분. electron 없이 돌아가므로 test.js 에서 그대로 시험한다.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const fileNameFor = require('./name');

// 메모 파일 첫 줄에 남기는 표시 겸 포스트잇 색. 고른 폴더에 다른 .html 이 섞여 있어도
// 앱이 그걸 메모로 착각해서 열거나 덮어쓰지 않는다.
const MARK = '<!--memo';
const DEFAULT_COLOR = '#fdf07a';
// auto 는 제목을 적지 않아 본문 첫 글로 이름을 지은 메모. 본문이 바뀌면 이름도 따라 바뀐다.
const header = (color, auto) => `${MARK} color=${/^#[0-9a-fA-F]{3,8}$/.test(color || '') ? color : DEFAULT_COLOR}${auto ? ' auto' : ''}-->`;

const IMAGE_EXT = /^\.(png|jpe?g|gif|webp|bmp)$/i;

// 화면(렌더러)이 넘긴 이름은 믿지 않는다. 메모 폴더 바로 안의 .html 파일 이름만 받는다 (../ 같은 경로 금지).
function inside(f, name) {
  if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.html')) {
    throw new Error('잘못된 메모 이름: ' + name);
  }
  return path.join(f, name);
}

function isMemo(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(MARK.length);
    fs.readSync(fd, b, 0, b.length, 0);
    return b.toString('utf8') === MARK;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// 사진은 메모 폴더 안 assets/ 에 두고 본문에는 상대경로로 적는다.
// 파일에는 상대경로, 화면에는 절대 file:// 주소 — PC마다 폴더 경로가 달라도 열린다.
const assetsDir = (f) => path.join(f, 'assets');
const trashDir = (f) => path.join(f, '휴지통');
const assetsUrl = (f) => pathToFileURL(assetsDir(f)).href;
const toScreen = (f, html) => html.split('src="assets/').join(`src="${assetsUrl(f)}/`);
const toDisk = (f, html) => html.split(`src="${assetsUrl(f)}/`).join('src="assets/');

// 같은 이름이 이미 있으면 덮어쓰지 않고 번호를 붙인다
function uniquify(f, next, self) {
  let n = next;
  for (let i = 2; n !== self && fs.existsSync(path.join(f, n)); i++) {
    n = next.replace(/\.html$/, ` (${i}).html`);
  }
  return n;
}

exports.MARK = MARK;
exports.DEFAULT_COLOR = DEFAULT_COLOR;

// 메모 이름과 마지막 저장 시각. 최근 것부터.
exports.listAt = (f) =>
  fs
    .readdirSync(f)
    .filter((n) => n.endsWith('.html') && isMemo(path.join(f, n)))
    .map((n) => ({ name: n, at: fs.statSync(path.join(f, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

exports.list = (f) => exports.listAt(f).map((x) => x.name);

exports.read = (f, name) => {
  const raw = fs.readFileSync(inside(f, name), 'utf8');
  const nl = raw.indexOf('\n');
  const first = nl < 0 ? raw : raw.slice(0, nl);
  return {
    html: toScreen(f, nl < 0 ? '' : raw.slice(nl + 1)),
    color: (first.match(/color=(#[0-9a-fA-F]{3,8})/) || [])[1] || DEFAULT_COLOR,
    auto: / auto-->/.test(first),
  };
};

exports.save = (f, name, title, html, color, auto) => {
  if (name) inside(f, name);
  const next = uniquify(f, fileNameFor(title), name);
  if (name && name !== next && fs.existsSync(inside(f, name))) {
    fs.renameSync(inside(f, name), inside(f, next));
  }
  fs.writeFileSync(inside(f, next), header(color, auto) + '\n' + toDisk(f, String(html)), 'utf8');
  return next;
};

exports.rename = (f, name, title) => {
  const from = inside(f, name);
  const next = uniquify(f, fileNameFor(title), name);
  if (next !== name) fs.renameSync(from, inside(f, next));
  return next;
};

// 지운 메모는 휴지통 폴더로 옮긴다. 저장 폴더가 드라이브여도 PC끼리 같이 따라간다.
// 사진 assets/ 는 그대로 두니 되살리면 사진도 함께 돌아온다.
// ponytail: 메모를 지워도 그 메모가 쓰던 assets/ 사진은 남는다.
// 폴더가 지저분해지면 그때 "안 쓰는 사진 정리"를 붙인다.
exports.remove = (f, name) => {
  const p = inside(f, name);
  if (!isMemo(p)) return; // 메모가 아닌 파일은 지우지 않는다
  fs.mkdirSync(trashDir(f), { recursive: true });
  fs.renameSync(p, path.join(trashDir(f), uniquify(trashDir(f), name, null)));
};

exports.listTrash = (f) =>
  fs.existsSync(trashDir(f)) ? fs.readdirSync(trashDir(f)).filter((n) => n.endsWith('.html')) : [];

// 같은 이름 메모가 그 사이 생겼으면 번호를 붙여 되살린다
exports.restore = (f, name) => {
  const from = inside(trashDir(f), name);
  const next = uniquify(f, name, null);
  fs.renameSync(from, path.join(f, next));
  return next;
};

exports.saveImage = (f, bytes, ext) => {
  if (!IMAGE_EXT.test(ext || '')) throw new Error('사진 파일이 아니다: ' + ext);
  fs.mkdirSync(assetsDir(f), { recursive: true });
  const name = Date.now() + '-' + Math.random().toString(36).slice(2, 7) + ext.toLowerCase();
  fs.writeFileSync(path.join(assetsDir(f), name), Buffer.from(bytes));
  return `${assetsUrl(f)}/${name}`;
};

// 저장 폴더 옮기기. 메모·사진·휴지통을 전부 복사해 크기까지 맞춰 본 뒤에야 원본을 지운다.
// 복사 중 실패하면 새 폴더에 만든 것만 치우고 던진다. 원본은 그대로다.
// 고른 폴더에 같은 이름 메모가 있으면 덮어쓰지 않고 번호를 붙인다. 바뀐 이름을 { 옛이름: 새이름 } 으로 돌려준다.
exports.moveAll = (from, to) => {
  const a = path.resolve(from), b = path.resolve(to);
  const low = (p) => p.toLowerCase();
  if (low(b) === low(a) || low(b).startsWith(low(a) + path.sep)) throw new Error('지금 폴더나 그 안의 폴더로는 옮길 수 없습니다.');
  const made = [], done = [];
  const copy = (src, dst) => {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    made.push(dst);
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(src).size !== fs.statSync(dst).size) throw new Error('복사가 끝까지 되지 않았습니다: ' + path.basename(src));
    done.push(src);
  };
  const names = {};
  try {
    for (const n of exports.list(from)) {
      names[n] = uniquify(to, n, null);
      copy(path.join(from, n), path.join(to, names[n]));
    }
    for (const n of exports.listTrash(from)) copy(path.join(trashDir(from), n), path.join(trashDir(to), uniquify(trashDir(to), n, null)));
    // 사진 이름은 시각+난수라 겹치면 같은 사진이다. 원본을 덮어쓰지 않고 건너뛴다.
    if (fs.existsSync(assetsDir(from))) {
      for (const n of fs.readdirSync(assetsDir(from))) {
        const dst = path.join(assetsDir(to), n);
        if (fs.existsSync(dst)) done.push(path.join(assetsDir(from), n));
        else copy(path.join(assetsDir(from), n), dst);
      }
    }
  } catch (e) {
    made.forEach((p) => fs.rmSync(p, { force: true }));
    throw e;
  }
  done.forEach((p) => fs.rmSync(p, { force: true }));
  for (const d of [assetsDir(from), trashDir(from)]) {
    if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d); // 비었으면 폴더도 치운다
  }
  return names;
};
