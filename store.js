// 메모 폴더에 파일을 읽고 쓰는 부분. electron 없이 돌아가므로 test.js 에서 그대로 시험한다.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const fileNameFor = require('./name');

// 메모 파일 첫 줄에 남기는 표시 겸 포스트잇 색. 고른 폴더에 다른 .html 이 섞여 있어도
// 앱이 그걸 메모로 착각해서 열거나 덮어쓰지 않는다.
const MARK = '<!--memo';
const DEFAULT_COLOR = '#fdf07a';
const header = (color) => `${MARK} color=${/^#[0-9a-fA-F]{3,8}$/.test(color || '') ? color : DEFAULT_COLOR}-->`;

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

exports.list = (f) =>
  fs
    .readdirSync(f)
    .filter((n) => n.endsWith('.html') && isMemo(path.join(f, n)))
    .map((n) => ({ name: n, at: fs.statSync(path.join(f, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.name);

exports.read = (f, name) => {
  const raw = fs.readFileSync(inside(f, name), 'utf8');
  const nl = raw.indexOf('\n');
  const first = nl < 0 ? raw : raw.slice(0, nl);
  return {
    html: toScreen(f, nl < 0 ? '' : raw.slice(nl + 1)),
    color: (first.match(/color=(#[0-9a-fA-F]{3,8})/) || [])[1] || DEFAULT_COLOR,
  };
};

exports.save = (f, name, title, html, color) => {
  if (name) inside(f, name);
  const next = uniquify(f, fileNameFor(title), name);
  if (name && name !== next && fs.existsSync(inside(f, name))) {
    fs.renameSync(inside(f, name), inside(f, next));
  }
  fs.writeFileSync(inside(f, next), header(color) + '\n' + toDisk(f, String(html)), 'utf8');
  return next;
};

exports.rename = (f, name, title) => {
  const from = inside(f, name);
  const next = uniquify(f, fileNameFor(title), name);
  if (next !== name) fs.renameSync(from, inside(f, next));
  return next;
};

// ponytail: 메모를 지워도 그 메모가 쓰던 assets/ 사진은 남는다.
// 폴더가 지저분해지면 그때 "안 쓰는 사진 정리"를 붙인다.
exports.remove = (f, name) => {
  const p = inside(f, name);
  if (isMemo(p)) fs.rmSync(p, { force: true }); // 메모가 아닌 파일은 지우지 않는다
};

exports.saveImage = (f, bytes, ext) => {
  if (!IMAGE_EXT.test(ext || '')) throw new Error('사진 파일이 아니다: ' + ext);
  fs.mkdirSync(assetsDir(f), { recursive: true });
  const name = Date.now() + '-' + Math.random().toString(36).slice(2, 7) + ext.toLowerCase();
  fs.writeFileSync(path.join(assetsDir(f), name), Buffer.from(bytes));
  return `${assetsUrl(f)}/${name}`;
};
