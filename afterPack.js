// 빌드한 exe 에 포스트잇 아이콘을 박는다.
// electron-builder 의 기본 방식(signAndEditExecutable)은 서명 도구를 풀 때 심볼릭 링크 권한이
// 필요해서 이 PC 에선 막힌다. 그래서 그 단계는 끄고 rcedit 로 아이콘만 직접 바꾼다.
const path = require('path');
const { rcedit } = require('rcedit');

exports.default = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(__dirname, 'icon.ico'),
    'version-string': { ProductName: '메모', FileDescription: '메모' },
  });
};
