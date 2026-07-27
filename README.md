# Canvas HiDPI 캔들 차트 비교

HTML5 Canvas로 캔들 차트를 그릴 때, **DPR을 쓰지 않은 naive 버퍼**와 **비트맵 크기 바인딩 + media/bitmap 좌표계**의 차이를 한 페이지에서 비교하는 데모입니다.

빌드·의존성 없이 `index.html`만 열면 동작합니다.

**라이브 데모:** https://jinung41.github.io/canvas-hidpi-candle-demo/

## 핵심 개념

고해상도(Retina 등) 화면에서는 CSS 픽셀보다 실제 디바이스 픽셀이 많습니다. Canvas 비트맵을 CSS 크기만으로 두면 브라우저가 확대해 보여 주면서 **글자·선이 흐려질** 수 있습니다.

| | DPR 미적용 | DPR + bitmap 좌표계 |
|---|---|---|
| 버퍼 | CSS 크기 | `device-pixel-content-box`(또는 predicted 크기) → suggested 후 draw 직전 apply |
| 좌표 | CSS 픽셀만 | media(시리즈·라벨) / bitmap(축·그리드·보조선, 1px 정렬) |
| transform | 없음 | `bitmapSize / mediaSize` 가로·세로 비율 |
| HiDPI에서 | 흐릴 수 있음 | 선명 |

오른쪽 패널의 비트맵·좌표계 기법은 [TradingView fancy-canvas](https://github.com/tradingview/fancy-canvas)에서 아이디어를 가져와 직접 구현했습니다. 라이브러리는 사용하지 않습니다 (`hidpi-canvas.js`).

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
- **40개**로 확대해 최고가·최저가 글자의 선명도를 비교
- **동기화** / **지금 맞추기**로 두 차트 구간을 맞출 수 있음
