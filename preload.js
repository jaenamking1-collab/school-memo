const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

// 포스트잇 창
contextBridge.exposeInMainWorld('memo', {
  state: call('state'),
  hide: call('hide'),
  menu: call('menu'),
  pin: call('pin'),
  newMemo: call('new-memo'),
  openLink: call('open-link'),
  claim: call('claim'),
  setDoc: call('set-doc'),
  list: call('list'),
  read: call('read'),
  save: call('save'),
  rename: call('rename'),
  remove: call('delete'),
  saveImage: call('save-image'),
  onFolderChanged: (fn) => ipcRenderer.on('folder-changed', fn),
  onColor: (fn) => ipcRenderer.on('color', (_e, hex) => fn(hex)),
});

// 화면 끝 탭 줄
contextBridge.exposeInMainWorld('dock', {
  dragStart: call('dock-drag-start'),
  drag: call('dock-drag'),
  dragEnd: call('dock-drag-end'),
  tab: call('dock-tab'),
  newMemo: call('new-memo'),
  menu: call('dock-menu'),
  onTabs: (fn) => ipcRenderer.on('tabs', (_e, tabs) => fn(tabs)),
});
