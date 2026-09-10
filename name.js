// 제목을 윈도우 파일명으로 바꾼다. 못 쓰는 글자는 걷어내고, 남는 게 없으면 시각으로 짓는다.
module.exports = function fileNameFor(title) {
  const clean = String(title || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') // 윈도우는 점/공백으로 끝나는 이름을 못 만든다
    .slice(0, 60)
    .trim();
  return (clean || new Date().toISOString().replace(/[:.]/g, '-')) + '.html';
};
