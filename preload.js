const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

// 포스트잇 창
contextBridge.exposeInMainWorld('memo', {
  state: call('state'),
  hide: call('hide'),
  menu: call('menu'),
  newMemo: call('new-memo'),
  openLink: call('open-link'),
  setDoc: call('set-doc'),
  dragStart: call('memo-drag-start'),
  drag: call('memo-drag'),
  dragEnd: call('memo-drag-end'),
  hover: call('memo-hover'),
  read: call('read'),
  save: call('save'),
  saveImage: call('save-image'),
  onForget: (fn) => ipcRenderer.on('forget', fn),
  fit: call('memo-fit'),
  shot: call('shot-start'),
  onShot: (fn) => ipcRenderer.on('shot', (_e, url, width) => fn(url, width)),
  resize: call('memo-resize'),
});

// 화면 끝 탭 줄
contextBridge.exposeInMainWorld('dock', {
  dragStart: call('dock-drag-start'),
  drag: call('dock-drag'),
  dragEnd: call('dock-drag-end'),
  tab: call('dock-tab'),
  newMemo: call('new-memo'),
  list: call('dock-list'),
  menu: call('dock-menu'),
  widthStart: call('dock-width-start'),
  width: call('dock-width'),
  widthEnd: call('dock-width-end'),
  peek: call('dock-peek'),
  unpeek: call('dock-unpeek'),
  onTabs: (fn) => ipcRenderer.on('tabs', (_e, tabs) => fn(tabs)),
});

// 메모 목록 창
contextBridge.exposeInMainWorld('memoList', {
  data: call('list-data'),
  open: call('list-open'),
  newMemo: call('list-new'),
  order: call('list-order'),
  remove: call('list-remove'),
  restore: call('list-restore'),
  folder: call('list-folder'),
  arrange: call('list-arrange'),
  onData: (fn) => ipcRenderer.on('list-data', (_e, d) => fn(d)),
});

// 스크린샷 영역 고르는 창
contextBridge.exposeInMainWorld('shot', {
  image: call('shot-image'),
  done: call('shot-done'),
});
