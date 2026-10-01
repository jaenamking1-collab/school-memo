const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

// 탭 크기는 dock.html 의 CSS 와 맞춰야 한다
const TAB_H = 30; // 탭 한 칸 높이 (탭 26 + 틈 4)
const DOCK_W = 58;
const PAD = 3;
const GAP = 4; // 탭·포스트잇 사이 틈
const SNAP = 30; // 이만큼 가까우면 화면 끝에 자석처럼 붙는다
const SIZE = { width: 270, height: 215 }; // 기본 포스트잇 (가로로 누운 직사각형)

const COLORS = [
  ['노랑', '#fdf07a'],
  ['분홍', '#ffc9d4'],
  ['하늘', '#b8e2ff'],
  ['연두', '#cdf0a7'],
  ['보라', '#ddc9ff'],
  ['주황', '#ffd7a0'],
];

// ---- 설정: 폴더 경로, 탭 위치, 포스트잇 크기, 항상 위, 열어둔 메모 ----
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
const tabbed = () => memos.filter((m) => m.win.isVisible() || m.pinned);

function dockHeight() {
  return (tabbed().length + 2) * TAB_H + PAD * 2 - 4; // 아래 ☰·+ 두 칸 포함, 마지막 틈은 뺀다
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
    // 떠 있는 것 + 고정해둔 것만 탭에 남는다. 고정 안 한 걸 최소화하면 아예 사라진다.
    tabs: tabbed()
      .map((m) => ({
        id: m.win.webContents.id,
        title: m.title || '제목 없음',
        color: m.color,
        on: m.win.isVisible(),
      })),
  });
  settings.open = memos.map((m) => ({ name: m.name, pinned: m.pinned, hidden: !m.win.isVisible() }));
  settings.dock = { x: p.x, y: p.y };
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

// 탭 줄에서 시작해 아래로, 자리가 없으면 옆 칸으로 — 이미 떠 있는 포스트잇과 겹치지 않는 첫 자리.
function positionMemo(m) {
  const d = dock.getBounds();
  const wa = workArea(d);
  const { width: w, height: h } = { ...SIZE, ...settings.size };
  const onLeft = d.x + d.width / 2 < wa.x + wa.width / 2;
  const spot = (c, r) => ({
    width: w,
    height: h,
    x: clamp(onLeft ? d.x + d.width + GAP + c * (w + GAP) : d.x - (c + 1) * (w + GAP), wa.x, wa.x + wa.width - w),
    y: clamp(d.y + PAD + Math.max(0, tabbed().indexOf(m)) * TAB_H + r * (h + GAP), wa.y, wa.y + wa.height - h),
  });

  const others = memos.filter((x) => x !== m && x.win.isVisible()).map((x) => x.win.getBounds());
  const overlaps = (a) =>
    others.some((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height);

  const cols = Math.max(1, Math.floor((onLeft ? wa.x + wa.width - d.x - d.width : d.x - wa.x) / (w + GAP)));
  const rows = Math.max(1, Math.ceil(wa.height / (h + GAP)));
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const box = spot(c, r);
      if (!overlaps(box)) return m.win.setBounds(box);
    }
  }
  m.win.setBounds(spot(0, 0)); // 화면이 다 찼으면 첫 자리
}

function createMemo(openName) {
  const { width, height } = { ...SIZE, ...settings.size };
  const win = new BrowserWindow({
    width,
    height,
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
  const m = { win, name: openName || null, title: '', color: store.DEFAULT_COLOR, pinned: false };
  memos.push(m);

  win.loadFile('index.html', { query: openName ? { open: openName } : {} });
  win.once('ready-to-show', () => {
    positionMemo(m);
    win.show();
    updateDock();
  });

  let t;
  win.on('resized', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!win.isDestroyed()) {
        const b = win.getBounds();
        settings.size = { width: b.width, height: b.height };
        saveSettings();
      }
    }, 500);
  });

  win.on('closed', () => {
    memos = memos.filter((x) => x !== m);
    updateDock();
  });
  return m;
}

// 탭을 누르면 그 메모가 나온다. 이미 떠 있으면 앞으로 꺼내기만 한다 (숨기면 탭이 없어져 못 찾는다).
function showMemo(m) {
  if (m.win.isVisible()) m.win.focus();
  else {
    positionMemo(m);
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

function listMenu() {
  Menu.buildFromTemplate([
    { label: '+ 새 메모', click: () => createMemo(null) },
    { type: 'separator' },
    ...memoItems(),
  ]).popup({ window: dock });
}

// 탭 줄에서도, 포스트잇 위에서도 같은 메뉴를 쓴다
function popupMenu(m) {
  const items = [
    { label: '새 메모', click: () => createMemo(null) },
    { label: '메모 목록', submenu: memoItems() },
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
        const m = createMemo(o.name);
        m.pinned = !!o.pinned;
        // 고정해서 최소화해둔 것은 탭만 남긴 채로 되살린다
        if (o.hidden && m.pinned) m.win.once('ready-to-show', () => (m.win.hide(), updateDock()));
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
let dragFrom;
ipcMain.handle('dock-drag-start', () => (dragFrom = dock.getBounds()));
ipcMain.handle('dock-drag', (_e, dx, dy) => {
  if (!dragFrom) return; // dragStart 가 아직 안 왔으면 무시
  const p = snapToEdge(dragFrom.x + dx, dragFrom.y + dy);
  dock.setPosition(p.x, p.y);
  memos.forEach((m) => m.win.isVisible() && positionMemo(m)); // 펼쳐둔 건 같이 따라온다
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
ipcMain.handle('new-memo', () => createMemo(null)); // 탭 줄의 + 와 목록의 + 새 메모 둘 다 쓴다
ipcMain.handle('dock-list', listMenu);
ipcMain.handle('dock-menu', () => popupMenu(null));

// ---- 포스트잇 ----
ipcMain.handle('state', (e) => ({ folder: folder(), pinned: !!find(e)?.pinned }));
// 최소화: 고정한 것만 탭에 남기고 숨긴다. 고정 안 했으면 아예 닫는다 (내용은 이미 파일에 있다).
ipcMain.handle('hide', (e) => {
  const m = find(e);
  if (!m) return;
  if (m.pinned) {
    m.win.hide();
    updateDock();
  } else {
    m.win.close();
  }
});
ipcMain.handle('menu', (e) => popupMenu(find(e)));
ipcMain.handle('color-menu', (e) => {
  const m = find(e);
  if (m) Menu.buildFromTemplate(colorItems(m)).popup({ window: m.win });
});

// 고정: 최소화해도 오른쪽 탭에 제목이 남는다
ipcMain.handle('pin', (e, v) => {
  const m = find(e);
  if (m) m.pinned = v;
  updateDock();
  return v;
});

// 메모 안의 링크는 기본 브라우저로 연다
ipcMain.handle('open-link', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// 같은 메모를 두 창에서 열면 서로 덮어쓴다. 이미 열려 있으면 그 창을 앞으로 꺼낸다.
ipcMain.handle('claim', (e, name) => {
  const other = memos.find((m) => m.name === name && m.win.webContents.id !== e.sender.id);
  if (!other) return true;
  showMemo(other);
  return false;
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
ipcMain.handle('list', () => (folder() ? store.list(folder()) : []));
ipcMain.handle('read', inFolder(store.read));
ipcMain.handle('save', inFolder(store.save));
ipcMain.handle('rename', inFolder(store.rename));
ipcMain.handle('delete', inFolder(store.remove));
ipcMain.handle('save-image', inFolder(store.saveImage));
