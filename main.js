const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { freeSpot, sortMemos, hits } = require('./place');

// 탭 크기는 dock.html 의 CSS 와 맞춰야 한다
const TAB_H = 30; // 탭 한 칸 높이 (탭 26 + 틈 4)
const DOCK_W = 62;
const PAD = 5;
const GAP = 4; // 탭·포스트잇 사이 틈
const SNAP = 30; // 이만큼 가까우면 화면 끝에 자석처럼 붙는다
const LIST = { width: 270, height: 480 }; // 메모 목록 창 (그림자 여백 포함)
const SIZE = { width: 270, height: 215 }; // 기본 포스트잇 (가로로 누운 직사각형)

const COLORS = [
  ['노랑', '#fdf07a'],
  ['분홍', '#ffc9d4'],
  ['하늘', '#b8e2ff'],
  ['연두', '#cdf0a7'],
  ['보라', '#ddc9ff'],
  ['주황', '#ffd7a0'],
];

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

async function pickFolder() {
  const r = await dialog.showOpenDialog(memos[0]?.win, {
    title: '메모를 저장할 폴더를 고르세요 (구글드라이브/원드라이브 폴더도 됩니다)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.folder = r.filePaths[0];
  saveSettings();
  return settings.folder;
}

const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), hi));
// getDisplayMatching 은 width/height 가 없으면 던진다. 점만 줘도 되게 채워준다.
const workArea = (b) =>
  require('electron').screen.getDisplayMatching({ width: 1, height: 1, ...b }).workArea;

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

function saveOpen() {
  settings.open = memos.map((m) => ({ name: m.name, hidden: !m.win.isVisible(), bounds: m.win.getBounds() }));
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
  const { width, height } = m.win.getBounds();
  m.win.setBounds(freeSpot(from, { width, height, gap: GAP }, workArea(from), others, direction(from)));
}

// 새 메모의 기준: 가장 나중에 연 포스트잇
function anchorFor(m) {
  const last = memos.filter((x) => x !== m && x.win.isVisible()).pop();
  return last ? last.win.getBounds() : dockAnchor(m.win.getBounds().width);
}

// opts.from: 이 자리 근처에 놓는다 / opts.bounds: 껐다 켰을 때 원래 자리·크기로 되살린다 / opts.hidden: 탭만 남긴다
function createMemo(openName, opts = {}) {
  const win = new BrowserWindow({
    ...SIZE,
    minWidth: 200,
    minHeight: 160,
    frame: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true, // 바탕화면 위젯이니 늘 위에 둔다
    backgroundColor: '#fdf07a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const m = { win, name: openName || null, title: '', color: store.DEFAULT_COLOR };
  memos.push(m);

  win.loadFile('index.html', { query: openName ? { open: openName } : {} });
  win.once('ready-to-show', () => {
    if (opts.bounds) {
      const b = opts.bounds, wa = workArea(b); // 모니터를 뺐으면 남은 화면 안으로 들어온다
      win.setBounds({ ...b, x: clamp(b.x, wa.x, wa.x + wa.width - b.width), y: clamp(b.y, wa.y, wa.y + wa.height - b.height) });
    } else placeNear(m, opts.from || anchorFor(m));
    if (!opts.hidden) win.show();
    updateDock();
  });

  win.on('resized', saveOpen);
  win.on('moved', saveOpen);
  win.on('focus', () => { if (peeked === m) peeked = null; }); // 눌러서 쓰기 시작하면 계속 떠 있는다

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
    const b = m.win.getBounds();
    if (memos.some((x) => x !== m && x.win.isVisible() && hits(b, x.win.getBounds()))) placeNear(m, anchorFor(m));
    m.win.show();
    m.win.focus();
  }
  updateDock();
}

// 포스트잇 색 고르기. 제목 줄의 🎨 버튼과 우클릭 메뉴가 같이 쓴다.
const colorItems = (m) =>
  COLORS.map(([label, hex]) => ({
    label,
    type: 'radio',
    checked: m.color === hex,
    click: () => {
      m.color = hex;
      m.win.setBackgroundColor(hex);
      m.win.webContents.send('color', hex);
      updateDock();
    },
  }));

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

// 고른 순서대로 탭 줄 옆부터 떠 있는 포스트잇을 다시 늘어놓는다
function arrange() {
  const others = [dock.getBounds()];
  const dir = direction(dock.getBounds());
  let from = null;
  for (const m of tabbed().filter((x) => x.win.isVisible())) {
    const { width, height } = m.win.getBounds();
    from = from || dockAnchor(width);
    const box = freeSpot(from, { width, height, gap: GAP }, workArea(from), others, dir);
    m.win.setBounds(box);
    others.push(box);
    from = box;
  }
  saveOpen();
}

function setOrder(order) {
  settings.order = order;
  updateDock();
  arrange();
  if (listWin) listWin.webContents.send('list-data', listData());
}

// ---- 메모 목록 창: 누른 곳 옆으로 펼쳐진다 ----
let listWin = null;
let listClosedAt = 0;
let listSide = 'left';

function listData() {
  const f = folder();
  const rows = (f ? store.listAt(f) : []).map(({ name, at }) => {
    const open = memos.find((x) => x.name === name);
    return { name, at, title: name.replace(/\.html$/i, ''), color: store.read(f, name).color, open: !!open && open.win.isVisible() };
  });
  return { order: settings.order || 'recent', side: listSide, items: sortMemos(rows, settings.order) };
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
  listWin.on('blur', () => listWin && listWin.close());
  listWin.on('closed', () => {
    listWin = null;
    listClosedAt = Date.now();
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
  if (m) {
    items.push({ label: '포스트잇 색', submenu: colorItems(m) });
    items.push({ type: 'separator' });
  }
  items.push(
    { role: 'cut', label: '잘라내기' },
    { role: 'copy', label: '복사' },
    { role: 'paste', label: '붙여넣기' },
    { type: 'separator' },
    { label: '메모 폴더 열기', click: () => folder() && shell.openPath(folder()) },
    {
      label: '저장 폴더 바꾸기',
      click: async () => {
        if (await pickFolder()) memos.forEach((x) => x.win.webContents.send('folder-changed'));
      },
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
  dragMemos = memos.filter((m) => m.win.isVisible()).map((m) => ({ m, b: m.win.getBounds() }));
  return (dragFrom = dock.getBounds());
});
ipcMain.handle('dock-drag', (_e, dx, dy) => {
  if (!dragFrom) return; // dragStart 가 아직 안 왔으면 무시
  const p = snapToEdge(dragFrom.x + dx, dragFrom.y + dy);
  dock.setPosition(p.x, p.y);
  // 펼쳐둔 건 늘어놓은 모양 그대로 같이 따라온다
  dragMemos.forEach(({ m, b }) => m.win.setPosition(b.x + p.x - dragFrom.x, b.y + p.y - dragFrom.y));
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
// 포스트잇의 + 는 그 메모 근처에, 탭 줄의 + 는 가장 나중에 연 메모 근처에 나온다
ipcMain.handle('new-memo', (e) => createMemo(null, { from: find(e)?.win.getBounds() }));
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
ipcMain.handle('color-menu', (e) => {
  const m = find(e);
  if (m) Menu.buildFromTemplate(colorItems(m)).popup({ window: m.win });
});

// 메모 안의 링크는 기본 브라우저로 연다
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
ipcMain.handle('open-list', (e) => {
  const m = find(e);
  if (m) openList(m.win.getBounds());
});
ipcMain.handle('list-data', listData);
// 같은 메모를 두 창에서 열면 서로 덮어쓴다. 이미 열려 있으면 그 창을 앞으로 꺼낸다.
ipcMain.handle('list-open', (_e, name) => {
  const open = memos.find((m) => m.name === name);
  if (open) showMemo(open);
  else createMemo(name);
  listWin?.close();
});
ipcMain.handle('list-new', () => {
  createMemo(null);
  listWin?.close();
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
