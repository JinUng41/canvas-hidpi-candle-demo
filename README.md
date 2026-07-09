# Canvas HiDPI 캔들 차트 비교

HTML5 Canvas로 캔들 차트를 그릴 때, **`devicePixelRatio`(DPR)를 적용하지 않은 경우**와 **적용한 경우**의 차이를 한 페이지에서 비교하는 데모입니다.

빌드·의존성 없이 `index.html`만 열면 동작합니다.

**라이브 데모:** https://jinung41.github.io/canvas-hidpi-candle-demo/

## 핵심 개념

고해상도(Retina 등) 화면에서는 CSS 픽셀보다 실제 디바이스 픽셀이 많습니다. Canvas 비트맵을 CSS 크기만으로 두면 브라우저가 확대해 보여 주면서 **글자·선이 흐려질** 수 있습니다.

이 데모는 같은 그리기 코드로 두 캔버스를 나란히 둡니다.

| | DPR 미적용 | DPR 적용 |
|---|---|---|
| 버퍼 | CSS 크기 | CSS 크기 × `devicePixelRatio` |
| 변환 | 없음 | `setTransform(dpr, …)` 후 CSS 좌표로 그림 |
| HiDPI에서 | 흐릴 수 있음 | 선명 |

`devicePixelRatio`가 1인 모니터에서는 차이가 거의 없을 수 있습니다. 페이지 상단의 DPR 값을 확인하세요.

## 실행

```bash
open index.html
```

또는:

```bash
npx --yes serve .
```

## 문서

| 문서 | 내용 |
|------|------|
| [구현 사항](docs/features.md) | 현재 기능·조작·레이아웃 · **Mermaid 구조도** |
| [스펙](SPEC.md) | 초기 요구사항·수락 기준 |
| [구현 계획](IMPLEMENTATION.md) | Phase별 구현 설계·제스처·줌 수식 |

## 빠른 조작 안내

- **휠 / 상하 드래그 / 핀치**: 확대·축소 · **좌우 드래그**: 이동
- **Shift+드래그** 또는 **영역 확대** 버튼 ON 후 드래그: 선택한 구간으로 확대
- **실시간** 버튼: 마지막 봉 틱 갱신·새 분봉 추가 (기본 ON)
- **40개**로 확대해 최고가·최저가 글자 선명도를 비교
- **동기화** / **지금 맞추기**로 두 차트 구간을 맞출 수 있음
