const { app, BrowserWindow, Menu, ipcMain, dialog, shell, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { freeSpot, stackBoxes, pushBoxes, reflow, sortMemos, hits } = require('./place');

// 탭 크기는 dock.html 의 CSS 와 맞춰야 한다
const TAB_H = 30; // 탭 한 칸 높이 (탭 26 + 틈 4)
const DOCK_W = 62;
const PAD = 5;
const GAP = 4; // 탭·포스트잇 사이 틈
const SNAP = 30; // 이만큼 가까우면 화면 끝에 자석처럼 붙는다
const MIN = { width: 200, height: 160 };
const HOTKEY = 'Ctrl+Alt+N'; // 어디서나 새 메모
const TOP = 44; // 화면 맨 위 이만큼은 비워 둔다 (최대화한 브라우저의 탭 줄)
const LIST = { width: 270, height: 480 }; // 메모 목록 창 (그림자 여백 포함)
const SIZE = { width: 270, height: 215 }; // 기본 포스트잇 (가로로 누운 직사각형)

// ---- 설정: 폴더 경로, 탭 위치, 정렬, 열어둔 메모(자리·크기 포함) ----
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};

function loadSettings() {
  settings = {};
  const p = settingsPath();
  if (!fs.existsSync(p)) return;
  try {
    settings = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); // BOM 붙은 파일도 읽는다
  } catch (e) {
    // 못 읽는다고 그냥 덮어쓰면 폴더 경로가 날아간다. 치워두고 새로 시작한다.
    fs.renameSync(p, p + '.bad');
    dialog.showErrorBox('메모', '설정 파일을 읽지 못해 settings.json.bad 로 옮겼습니다.\n저장 폴더를 다시 골라주세요.\n\n' + e.message);
  }
  delete settings.bounds; // 예전 버전이 쓰던 값
  delete settings.size;
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function folder() {
  return settings.folder && fs.existsSync(settings.folder) ? settings.folder : null;
}

async function askFolder() {
  const r = await dialog.showOpenDialog({
    title: '메모를 저장할 폴더를 고르세요 (구글드라이브/원드라이브 폴더도 됩니다)',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0] || null;
}

async function pickFolder() {
  const f = await askFolder();
  if (!f) return null;
  settings.folder = f;
  saveSettings();
  return f;
}

// 저장 폴더를 바꾸고 기존 메모·사진·휴지통을 전부 옮긴다.
// 열린 창의 사진 주소가 옛 폴더를 보고 있어 저장하면 깨지므로, 창은 비우고 새 폴더 기준으로 다시 연다.
async function changeFolder() {
  const from = folder();
  const to = await askFolder();
  if (!to) return;
  let names = {};
  try {
    if (from) names = store.moveAll(from, to);
  } catch (e) {
    dialog.showErrorBox('메모', '옮기지 못했습니다. 메모는 원래 폴더에 그대로 있습니다.\n\n' + e.message);
    return;
  }
  settings.folder = to;
  saveSettings();
  const open = memos.map((m) => ({ m, name: m.name && names[m.name], hidden: !m.win.isVisible(), bounds: place(m) }));
  open.forEach(({ m }) => m.win.webContents.send('forget'));
  setTimeout(() => {
    open.forEach(({ m }) => m.win.close());
    open.forEach(({ name, hidden, bounds }) => name && createMemo(name, { hidden, bounds }));
    if (!open.some((x) => x.name)) createMemo(null);
  }, 150);
  dialog.showMessageBox({ type: 'info', title: '메모', message: `메모 ${Object.keys(names).length}개를 새 폴더로 옮겼습니다.`, detail: to });
}

const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), hi));
// getDisplayMatching 은 width/height 가 없으면 던진다. 점만 줘도 되게 채워준다.
const workArea = (b) =>
  require('electron').screen.getDisplayMatching({ width: 1, height: 1, ...b }).workArea;

// 포스트잇을 자동으로 놓는 범위. 사용자가 직접 끌어 옮기는 건 막지 않는다.
const memoArea = (b) => {
  const wa = workArea(b);
  return { ...wa, y: wa.y + TOP, height: wa.height - TOP };
};

let hotkeyOn = false; // 다른 프로그램이 먼저 쓰고 있으면 등록되지 않는다. 그때는 + 설명에서 뺀다.
let dock; // 화면 끝에 붙는 제목 탭 줄
let memos = []; // [{ win, name, title }] 띄워둔 포스트잇들
const find = (e) => memos.find((m) => m.win.webContents.id === e.sender.id);

// ---- 탭 줄 ----
// 고른 정렬 순서대로. 저장 전인 새 메모는 at 이 없어 최근순 맨 위에 온다.
function tabbed() {
  const at = new Map((folder() ? store.listAt(folder()) : []).map((x) => [x.name, x.at]));
  const rows = memos.map((m) => ({ m, title: m.title || '', at: at.get(m.name) }));
  return sortMemos(rows, settings.order).map((x) => x.m);
}

function dockHeight() {
  return (memos.length + 2) * TAB_H + PAD * 2 - 4; // 아래 ☰·+ 두 칸 포함, 마지막 틈은 뺀다
}

// 화면 끝 가까이 가면 딱 붙인다
function snapToEdge(x, y) {
  const h = dockHeight();
  const wa = workArea({ x, y, width: DOCK_W, height: h });
  const right = wa.x + wa.width - DOCK_W;
  const bottom = wa.y + wa.height - h;
  if (x - wa.x < SNAP) x = wa.x;
  else if (right - x < SNAP) x = right;
  if (y - wa.y < SNAP) y = wa.y;
  else if (bottom - y < SNAP) y = bottom;
  return { x: clamp(x, wa.x, right), y: clamp(y, wa.y, Math.max(wa.y, bottom)) };
}

function updateDock() {
  if (!dock || dock.isDestroyed()) return;
  const b = dock.getBounds();
  const p = snapToEdge(b.x, b.y); // 탭이 늘면 화면 밖으로 나가지 않게 다시 맞춘다
  dock.setBounds({ x: p.x, y: p.y, width: DOCK_W, height: dockHeight() });
  const wa = workArea(p); // 옆 모니터로 옮겼으면 그 모니터 기준으로 다시 본다
  dock.webContents.send('tabs', {
    // 북마크의 파인 쪽이 화면 안쪽(벽 반대편)을 보도록
    side: p.x + DOCK_W / 2 < wa.x + wa.width / 2 ? 'left' : 'right',
    hotkey: hotkeyOn ? HOTKEY : '',
    // 최소화한 것도 흐리게 탭에 남는다
    tabs: tabbed()
      .map((m) => ({
        id: m.win.webContents.id,
        title: m.title || '제목 없음',
        color: m.color,
        on: m.win.isVisible(),
      })),
  });
  settings.dock = { x: p.x, y: p.y };
  saveOpen();
}

// 소수 배율 모니터에서는 창 크기를 읽어 그대로 넣으면 넣을 때마다 몇 px씩 커진다.
// 그래서 크기는 m.size 에 따로 두고, 옮길 때는 항상 그 값으로 넣는다.
const place = (m) => ({ ...m.win.getBounds(), ...m.size });
const put = (m, { x, y }) => m.win.setBounds({ x, y, ...m.size });

function saveOpen() {
  // 목록 때문에 잠깐 비켜난 메모는 원래 자리를 적는다
  settings.open = memos.map((m) => ({ name: m.name, hidden: !m.win.isVisible(), bounds: m.home || place(m) }));
  saveSettings();
}

function createDock() {
  const wa = require('electron').screen.getPrimaryDisplay().workArea;
  // 경계값(wa.x + wa.width)을 주면 옆 모니터로 넘어간다. 폭을 빼서 이 화면 안에 둔다.
  const saved = settings.dock || { x: wa.x + wa.width - DOCK_W, y: wa.y + Math.round(wa.height / 4) };
  const p = snapToEdge(saved.x, saved.y);
  dock = new BrowserWindow({
    ...p,
    width: DOCK_W,
    height: dockHeight(),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  dock.setAlwaysOnTop(true, 'screen-saver'); // 전체화면 위에도 남는다
  dock.loadFile('dock.html');
  dock.webContents.once('did-finish-load', updateDock);
}

// 펼칠 방향: 화면 오른쪽에 있으면 왼쪽으로, 왼쪽에 있으면 오른쪽으로
function direction(b) {
  const wa = workArea(b);
  return b.x + b.width / 2 < wa.x + wa.width / 2 ? 1 : -1;
}

// 포스트잇이 하나도 안 떠 있을 때의 기준 자리: 탭 줄 바로 옆
function dockAnchor(width) {
  const d = dock.getBounds();
  return { x: direction(d) < 0 ? d.x - GAP - width : d.x + d.width + GAP, y: d.y, width, height: 0 };
}

function placeNear(m, from) {
  const others = [dock, ...memos.filter((x) => x !== m && x.win.isVisible()).map((x) => x.win)].map((w) => w.getBounds());
  put(m, freeSpot(from, { ...m.size, gap: GAP }, memoArea(from), others, direction(from)));
}

// 새 메모의 기준: 가장 나중에 쓴 포스트잇 (focus 때 memos 맨 뒤로 온다)
function anchorFor(m) {
  const last = memos.filter((x) => x !== m && x.win.isVisible()).pop();
  return last ? place(last) : dockAnchor(m.size.width);
}

// opts.from: 이 자리 근처에 놓는다 / opts.bounds: 껐다 켰을 때 원래 자리·크기로 되살린다 / opts.hidden: 탭만 남긴다
function createMemo(openName, opts = {}) {
  const win = new BrowserWindow({
    ...SIZE,
    // 크기 조절은 index.js 의 테두리가 맡는다. 윈도우에 맡기면 테두리 더블클릭을 앱이 받지 못하고
    // 아래 테두리 더블클릭이 창을 세로로 끝까지 늘려 버린다.
    resizable: false,
    frame: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true, // 바탕화면 위젯이니 늘 위에 둔다
    backgroundColor: '#fdf07a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const m = { win, name: openName || null, title: '', color: store.DEFAULT_COLOR, size: { ...SIZE } };
  memos.push(m);

  win.loadFile('index.html', { query: openName ? { open: openName } : {} });
  win.once('ready-to-show', () => {
    if (opts.bounds) {
      const b = opts.bounds, wa = memoArea(b); // 모니터를 뺐으면 남은 화면 안으로 들어온다
      m.size = { width: b.width, height: b.height };
      put(m, { x: clamp(b.x, wa.x, wa.x + wa.width - b.width), y: clamp(b.y, wa.y, wa.y + wa.height - b.height) });
    } else placeNear(m, opts.from || anchorFor(m));
    if (!opts.hidden) win.show();
    updateDock();
  });

  win.on('moved', saveOpen);
  win.on('focus', () => {
    if (peeked === m) peeked = null; // 눌러서 쓰기 시작하면 계속 떠 있는다
    memos = [...memos.filter((x) => x !== m), m];
  });

  win.on('closed', () => {
    memos = memos.filter((x) => x !== m);
    updateDock();
  });
  return m;
}

// 탭을 누르면 그 메모가 나온다. 이미 떠 있으면 앞으로 꺼내기만 한다 (숨기면 탭이 없어져 못 찾는다).
function showMemo(m) {
  if (peeked === m) peeked = null;
  if (m.win.isVisible()) m.win.focus();
  else {
    // 최소화했던 자리가 그 사이 다른 메모로 찼으면 빈자리로 옮긴다
    const b = place(m);
    if (memos.some((x) => x !== m && x.win.isVisible() && hits(b, x.win.getBounds()))) placeNear(m, anchorFor(m));
    m.win.show();
    m.win.focus();
  }
  updateDock();
}

// 저장된 메모 전부를 메뉴로. 포스트잇이 하나도 안 떠 있어도 여기서 바로 연다.
function memoItems() {
  const f = folder();
  const names = f ? store.list(f) : [];
  if (!names.length) return [{ label: '저장된 메모 없음', enabled: false }];
  return names.map((n) => {
    const open = memos.find((x) => x.name === n);
    return {
      label: n.replace(/\.html$/i, ''),
      type: 'checkbox',
      checked: !!open && open.win.isVisible(), // 지금 떠 있는 메모엔 표시
      click: () => (open ? showMemo(open) : createMemo(n)),
    };
  });
}

// 고른 순서대로 탭 줄 쪽 벽부터 떠 있는 포스트잇을 붙여 쌓는다
function arrange() {
  const d = dock.getBounds();
  const dir = direction(d);
  const shown = tabbed().filter((x) => x.win.isVisible());
  const edge = dir < 0 ? d.x - GAP : d.x + d.width + GAP;
  const boxes = stackBoxes(shown.map((m) => m.size), memoArea(d), edge, dir, GAP);
  shown.forEach((m, i) => put(m, boxes[i]));
  saveOpen();
}

function setOrder(order) {
  settings.order = order;
  updateDock();
  comeBack(true);
  arrange();
  if (listWin) {
    pushAside(listWin.getBounds());
    listWin.webContents.send('list-data', listData());
  }
}

// ---- 목록 창이 뒤의 메모를 가리지 않게: 열리면 옆으로 비켜나고 닫히면 돌아온다 ----
let slideTimer;
function slide(moves) {
  clearInterval(slideTimer);
  const starts = moves.map(({ m }) => m.win.getBounds());
  let step = 0;
  slideTimer = setInterval(() => {
    step++;
    moves.forEach(({ m, to }, i) => {
      if (m.win.isDestroyed()) return;
      const at = (a, b) => Math.round(a + ((b - a) * step) / 6);
      put(m, { x: at(starts[i].x, to.x), y: at(starts[i].y, to.y) });
    });
    if (step === 6) clearInterval(slideTimer);
  }, 16);
}

function pushAside(list) {
  const wa = workArea(list);
  const seen = { x: list.x + 10, y: list.y + 10, width: list.width - 20, height: list.height - 20 }; // 가장자리 여백은 그림자 자리다
  const shown = memos.filter((m) => m.win.isVisible() && workArea(place(m)).x === wa.x);
  const boxes = shown.map(place);
  const next = pushBoxes(boxes, seen, listSide === 'left' ? -1 : 1, GAP);
  const moves = [];
  shown.forEach((m, i) => {
    if (next[i].x === boxes[i].x) return;
    m.home = boxes[i];
    moves.push({ m, to: { ...boxes[i], x: clamp(next[i].x, wa.x, wa.x + wa.width - boxes[i].width) } });
  });
  if (moves.length) slide(moves);
}

function comeBack(now) {
  clearInterval(slideTimer);
  const moves = memos.filter((m) => m.home && !m.win.isDestroyed()).map((m) => ({ m, to: m.home }));
  memos.forEach((m) => delete m.home);
  if (now) moves.forEach(({ m, to }) => put(m, to));
  else if (moves.length) slide(moves);
}

// ---- 메모 목록 창: 누른 곳 옆으로 펼쳐진다 ----
let listWin = null;
let listClosedAt = 0;
let listSide = 'left';

// 찾기용 글자만 남긴다
const plain = (html) =>
  html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function listData() {
  const f = folder();
  const rows = (f ? store.listAt(f) : []).map(({ name, at }) => {
    const open = memos.find((x) => x.name === name);
    const doc = store.read(f, name);
    return { name, at, title: name.replace(/\.html$/i, ''), text: plain(doc.html), color: doc.color, open: !!open && open.win.isVisible() };
  });
  return { order: settings.order || 'recent', side: listSide, items: sortMemos(rows, settings.order), trash: f ? store.listTrash(f) : [] };
}

function openList(from) {
  if (listWin) return listWin.close();
  // 목록이 열린 채 그 버튼을 누르면 포커스를 잃어 먼저 닫힌다. 바로 다시 열지 않는다.
  if (Date.now() - listClosedAt < 400) return;
  const wa = workArea(from);
  const height = Math.min(LIST.height, wa.height);
  listSide = direction(from) < 0 ? 'left' : 'right';
  const x = listSide === 'left' ? from.x - LIST.width : from.x + from.width;
  listWin = new BrowserWindow({
    x: clamp(x, wa.x, wa.x + wa.width - LIST.width),
    y: clamp(from.y, wa.y, wa.y + wa.height - height),
    width: LIST.width,
    height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  listWin.setAlwaysOnTop(true, 'screen-saver'); // 탭 줄보다 아래로 깔리지 않게
  listWin.loadFile('list.html');
  pushAside(listWin.getBounds());
  listWin.on('blur', () => listWin && listWin.close());
  listWin.on('closed', () => {
    listWin = null;
    listClosedAt = Date.now();
    comeBack();
  });
}

// ---- 탭에 마우스를 올리면 잠깐 뜨는 메모 ----
let peeked = null;
let peekTimer;
function endPeekSoon() {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (peeked && !peeked.win.isDestroyed()) peeked.win.hide();
    peeked = null;
  }, 300);
}

// 탭 줄에서도, 포스트잇 위에서도 같은 메뉴를 쓴다
function popupMenu(m) {
  const items = [
    { label: '새 메모', click: () => createMemo(null) },
    { label: '메모 목록', submenu: memoItems() },
    {
      label: '메모 정렬',
      submenu: [['최근순', 'recent'], ['이름순', 'name']].map(([label, order]) => ({
        label,
        click: () => setOrder(order),
      })),
    },
    { type: 'separator' },
  ];
  items.push(
    { role: 'cut', label: '잘라내기' },
    { role: 'copy', label: '복사' },
    { role: 'paste', label: '붙여넣기' },
    { type: 'separator' },
    { label: '메모 폴더 열기', click: () => folder() && shell.openPath(folder()) },
    {
      label: '설정',
      submenu: [
        { label: '저장 폴더 바꾸기 (메모도 함께 옮김)', click: changeFolder },
        { label: '지금 폴더: ' + (folder() || '없음'), enabled: false },
      ],
    },
    { type: 'separator' }
  );
  if (m) items.push({ label: '이 포스트잇 닫기', click: () => m.win.close() });
  items.push({
    label: '종료',
    click: () => {
      app.isQuitting = true;
      app.quit();
    },
  });
  Menu.buildFromTemplate(items).popup({ window: m ? m.win : dock });
}

// ---- 자동 업데이트 ----
// 깃허브 릴리스에 새 버전이 올라오면 받아두고, 다 받으면 재시작할지 묻는다.
// 위젯은 거의 꺼지지 않으니 시작할 때 한 번 + 6시간마다 본다.
function watchForUpdates() {
  if (!app.isPackaged) return; // 소스로 띄울 땐 확인하지 않는다
  const { autoUpdater } = require('electron-updater');
  autoUpdater.on('error', (e) => console.error('update:', e.message)); // 인터넷이 없어도 오류창을 띄우지 않는다
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
      message: `메모 새 버전(${info.version})을 받았습니다.`,
      detail: '지금 재시작하면 바로 적용됩니다. 나중에를 누르면 메모를 종료할 때 적용됩니다.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

// 두 개가 동시에 뜨면 같은 파일을 서로 덮어쓴다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => dock && dock.show());

  app.whenReady().then(async () => {
    loadSettings();
    hotkeyOn = globalShortcut.register(HOTKEY, quickMemo);
    createDock();
    watchForUpdates();
    if (!folder()) await pickFolder();
    // 지난번에 띄워둔 포스트잇을 그대로 되살린다
    const open = (settings.open || []).filter((o) => o.name);
    if (open.length) {
      open.forEach((o) => {
        createMemo(o.name, { bounds: o.bounds, hidden: o.hidden });
      });
    } else {
      createMemo((folder() && store.list(folder())[0]) || null);
    }
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {}); // 탭 줄로 살아있는다

// 창이 다른 주소로 넘어가거나 새 창을 열지 못하게 한다.
// 넘어간 페이지가 window.memo(메모 읽기·쓰기·삭제)를 쓰게 되면 안 된다.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ---- 탭 줄 ----
let dragFrom, dragMemos;
ipcMain.handle('dock-drag-start', () => {
  dragMemos = memos.filter((m) => m.win.isVisible()).map((m) => ({ m, b: place(m) }));
  return (dragFrom = dock.getBounds());
});
ipcMain.handle('dock-drag', (_e, dx, dy) => {
  if (!dragFrom) return; // dragStart 가 아직 안 왔으면 무시
  const p = snapToEdge(dragFrom.x + dx, dragFrom.y + dy);
  dock.setPosition(p.x, p.y);
  // 펼쳐둔 건 늘어놓은 모양 그대로 같이 따라온다
  dragMemos.forEach(({ m, b }) => put(m, { x: b.x + p.x - dragFrom.x, y: b.y + p.y - dragFrom.y }));
});
ipcMain.handle('dock-drag-end', () => {
  const b = dock.getBounds();
  settings.dock = { x: b.x, y: b.y };
  updateDock(); // 화면 반대편으로 옮겼으면 북마크 파인 쪽도 뒤집어야 한다
});
ipcMain.handle('dock-tab', (_e, id) => {
  const m = memos.find((x) => x.win.webContents.id === id);
  if (m) showMemo(m);
});
ipcMain.handle('dock-peek', (_e, id) => {
  clearTimeout(peekTimer);
  if (peeked && peeked.win.webContents.id !== id) { peeked.win.hide(); peeked = null; }
  const m = memos.find((x) => x.win.webContents.id === id);
  if (!m) return;
  if (m.win.isVisible()) return m.win.moveTop();
  peeked = m;
  m.win.showInactive(); // 쓰던 창의 커서를 빼앗지 않는다
});
ipcMain.handle('dock-unpeek', endPeekSoon);
ipcMain.handle('memo-hover', (e, on) => {
  if (!peeked || peeked !== find(e)) return;
  if (on) clearTimeout(peekTimer);
  else endPeekSoon();
});
// 단축키: 비어 있는 새 메모가 이미 떠 있으면 또 만들지 않고 그걸 쓴다
function quickMemo() {
  const blank = memos.find((m) => !m.name && m.win.isVisible());
  if (blank) blank.win.focus();
  else createMemo(null);
}

// 포스트잇의 + 는 그 메모 근처에, 탭 줄의 + 는 가장 나중에 연 메모 근처에 나온다
ipcMain.handle('new-memo', (e) => {
  const m = find(e);
  createMemo(null, { from: m && place(m) });
});
ipcMain.handle('dock-list', () => openList(dock.getBounds()));
ipcMain.handle('dock-menu', () => popupMenu(null));

// ---- 포스트잇 ----
ipcMain.handle('state', () => ({ folder: folder() }));
// 최소화: 탭에 남기고 숨긴다. 아무것도 안 적은 새 메모는 남길 게 없으니 닫는다.
ipcMain.handle('hide', (e) => {
  const m = find(e);
  if (!m) return;
  if (!m.name) return m.win.close();
  if (peeked === m) peeked = null;
  m.win.hide();
  updateDock();
});
ipcMain.handle('menu', (e) => popupMenu(find(e)));

// 메모 안의 링크는 기본 브라우저로 연다
// 제목 줄로 창을 끈다
ipcMain.handle('memo-drag-start', (e) => {
  const m = find(e);
  if (!m) return;
  delete m.home;
  m.dragFrom = place(m);
});
ipcMain.handle('memo-drag', (e, dx, dy) => {
  const m = find(e);
  if (m?.dragFrom) put(m, { x: m.dragFrom.x + dx, y: m.dragFrom.y + dy });
});
ipcMain.handle('memo-drag-end', saveOpen);

// 테두리로 끌어서 크기 바꾸기. edge 에 l·r·b 가 들어 있는 쪽이 움직인다.
ipcMain.handle('memo-resize', (e, edge, dx, dy) => {
  const m = find(e);
  if (!m?.dragFrom) return;
  const f = m.dragFrom;
  const width = Math.max(MIN.width, f.width + (edge.includes('l') ? -dx : edge.includes('r') ? dx : 0));
  const height = Math.max(MIN.height, f.height + (edge.includes('b') ? dy : 0));
  m.size = { width, height };
  put(m, { x: edge.includes('l') ? f.x + f.width - width : f.x, y: f.y });
});

// 내용에 맞춘 크기로 바꾸고 주변 메모를 따라 옮긴다. 화면 끝 쪽 변은 그 자리에 둔다.
ipcMain.handle('memo-fit', (e, w, h) => {
  const m = find(e);
  if (!m) return;
  const old = place(m), area = memoArea(old), dir = direction(old);
  const width = clamp(w, MIN.width, area.width), height = clamp(h, MIN.height, area.height);
  const next = {
    x: clamp(dir < 0 ? old.x + old.width - width : old.x, area.x, area.x + area.width - width),
    y: clamp(old.y, area.y, area.y + area.height - height),
    width,
    height,
  };
  const shown = memos.filter((x) => x !== m && x.win.isVisible() && workArea(place(x)).x === workArea(old).x);
  const boxes = reflow(shown.map(place), old, next, dir, GAP, area, [dock.getBounds()]);
  m.size = { width, height };
  put(m, next);
  slide(shown.map((x, i) => ({ m: x, to: boxes[i] })));
  setTimeout(saveOpen, 200);
});

ipcMain.handle('open-link', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('set-doc', (e, name, title, color) => {
  const m = find(e);
  if (!m) return;
  m.name = name;
  m.title = title;
  if (color && color !== m.color) {
    m.color = color;
    m.win.setBackgroundColor(color);
  }
  updateDock();
});

const inFolder = (fn) => (_e, ...a) => (folder() ? fn(folder(), ...a) : null);
ipcMain.handle('read', inFolder(store.read));
ipcMain.handle('save', inFolder(store.save));
ipcMain.handle('save-image', inFolder(store.saveImage));

// ---- 메모 목록 창 ----
ipcMain.handle('list-data', listData);
// 같은 메모를 두 창에서 열면 서로 덮어쓴다. 이미 열려 있으면 그 창을 앞으로 꺼낸다.
ipcMain.handle('list-open', (_e, name) => {
  const open = memos.find((m) => m.name === name);
  comeBack(true); // 새 자리는 메모가 제자리에 돌아온 뒤에 계산한다
  if (open) showMemo(open);
  else createMemo(name);
  listWin?.close();
});
ipcMain.handle('list-new', () => {
  comeBack(true);
  createMemo(null);
  listWin?.close();
});
ipcMain.handle('list-restore', (_e, name) => {
  if (!folder()) return;
  comeBack(true);
  createMemo(store.restore(folder(), name));
  listWin?.close();
});
ipcMain.handle('list-folder', () => {
  comeBack(true); // 비켜난 자리가 아니라 제자리를 기억하고 옮긴다
  listWin?.close();
  return changeFolder();
});
ipcMain.handle('list-order', (_e, order) => setOrder(order === 'name' ? 'name' : 'recent'));
ipcMain.handle('list-remove', (_e, name) => {
  const open = memos.find((m) => m.name === name);
  if (open) open.win.webContents.send('forget');
  // 창이 닫힐 때 저장해 버리지 않게, 비운 다음에 닫고 지운다
  setTimeout(() => {
    open?.win.close();
    if (folder()) store.remove(folder(), name);
    listWin?.webContents.send('list-data', listData());
  }, 120);
});
