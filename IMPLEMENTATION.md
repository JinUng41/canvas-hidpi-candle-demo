# 구현 계획

스펙(`SPEC.md`)을 코드로 옮기기 위한 단계별 계획이다.  
목표: **작은 단위로 동작 확인하며** 쌓아 올리고, 마지막에 동기화·폴리시만 붙인다.

> 리뷰 반영 (제스처 상태머신·핀치/휠 수식·activeChart·단일 viewport 진입점·시드/OHLC·축 규칙·DPR 감지).  
> **구현 완료 후 현황**은 [docs/features.md](docs/features.md)를 본다. 본 문서는 설계·Phase 기록용이다.

---

## 0. 결과물

| 파일 | 역할 |
|------|------|
| `index.html` | 마크업: 헤더, 공통 컨트롤, 차트 패널 2개 |
| `styles.css` | 레이아웃·반응형·컨트롤 스타일 |
| `chart.js` | 데이터·뷰포트·렌더·제스처·동기화 |
| `README.md` | 소개·핵심 개념·문서 링크 |
| `docs/features.md` | 현재 구현 사항 (완료 후 작성) |

외부 의존성 없음. `index.html`을 브라우저로 열면 동작.

---

## 1. 모듈 경계 (`chart.js` 내부)

한 파일이지만 책임은 아래처럼 나눈다. (함수/섹션 주석으로 구분)

```
[1] 상수·유틸
[2] 데이터 생성
[3] 뷰포트 모델 + applyViewport (단일 진입점)
[4] 캔버스 준비 (DPR on/off)
[5] 좌표 변환
[6] 렌더 (그리드·캔들·축·min/max) — 공통 drawChart
[7] 차트 인스턴스 (상태 + draw + 제스처 → applyViewport 호출)
[8] 앱 오케스트레이션 (두 차트, active, 동기화, 버튼, 리사이즈)
```

### 핵심 데이터 구조

```js
// 캔들
{ time, open, high, low, close }

// 뷰포트 (차트마다 독립, 둘 다 실수 허용)
{
  startIndex: number,   // 보이는 구간의 왼쪽 가장자리 (실수 → 팬 부드럽게)
  visibleCount: number  // 화면에 보이는 캔들 개수 (실수 허용)
}

// 차트 인스턴스
{
  id: 'raw' | 'dpr',
  canvas, ctx,
  useDPR: boolean,
  viewport,
  layout: { cssW, cssH, plotLeft, plotTop, plotWidth, plotHeight }
}
```

### 좌표 · 인덱스 규칙

- X: `startIndex` ~ `startIndex + visibleCount` → plot 가로
- Y: 보이는 구간 `priceMin`~`priceMax` (패딩 약 5%) → plot 세로 (위=고가)
- 모든 그리기·히트테스트는 **CSS 픽셀** 기준 (DPR 적용 시 `setTransform` 이후)
- 그리기 루프 인덱스:
  - `from = Math.floor(startIndex)`
  - `toExclusive = Math.min(candles.length, Math.ceil(startIndex + visibleCount))`
  - half-open `[from, toExclusive)`
- 캔들 중심 X는 **실수 인덱스** `i` 기준: `indexToX(i + 0.5)` 등
- plot 밖은 `ctx.clip()`으로 잘라낸다
- **최고/최저·가격 extent**: 위 `[from, toExclusive)`에 걸친 캔들 포함 (부분 노출 포함)
- 클램프:
  - `visibleCount ∈ [20, candles.length]`
  - `startIndex ∈ [0, candles.length - visibleCount]`

### 단일 viewport 진입점 (필수)

모든 줌/팬/버튼/프리셋/리셋/맞추기/동기화 복사는 아래만 통한다.

```js
function applyViewport(sourceId, nextViewport, { sync = syncEnabled } = {}) {
  // 1) source에 clamp 후 적용 + draw
  // 2) sync === true 이면 other에도 동일 viewport 복사 + draw
  // 3) 값이 거의 같으면 skip (루프 방지)
  // 4) isApplyingSync 가드로 재진입 차단
}
```

차트 제스처는 `onInteract(sourceId)`로 active만 갱신하고, 실제 변경은 `applyViewport`로 한다.

---

## 2. 단계별 구현

각 단계 끝에 **브라우저에서 확인할 것**을 둔다. 통과 후 다음 단계로.

### Phase 1 — 골격 UI

**작업**
- `index.html` 문구는 SPEC §8과 동일:
  - 제목: `Canvas HiDPI 캔들 차트 비교`
  - 안내: `확대해 최고가·최저가 글자의 선명도를 비교해 보세요.`
  - 버튼 텍스트: `확대`, `축소`, `리셋`, `500개`, `40개`, `동기화`, `지금 맞추기`
  - DPR: `현재 devicePixelRatio: {n}`
- 공통 컨트롤 + 패널 2개 (`#panel-raw` / `#panel-dpr`, `canvas#chart-raw` / `canvas#chart-dpr`)
- 각 패널: 제목, `조작 중` 배지 자리, 로컬 `확대`/`축소`/`리셋`, canvas
- `동기화`: checkbox + 라벨 (토글 UX)
- `styles.css`: grid 2열 → 좁으면 1열, 캔버스 `width:100%`, 높이 ~400px
- **차트 패널 컨테이너**에 `touch-action: none` (페이지 스크롤은 패널 밖에서 허용)

**확인**
- 리사이즈 시 좌우 ↔ 세로 전환
- 한글 문구·버튼이 SPEC과 일치하는지

---

### Phase 2 — 데이터 + 캔버스 버퍼 (DPR on/off)

**작업**
- `generateCandles(count = 2000, seed = 42)` — **시드 기본 고정** (mulberry32 등)
- 시작 시각: `Date.UTC(2024, 0, 1, 9, 0, 0)` 부터 1분 간격 (UTC 고정, 라벨도 UTC 또는 local 중 **UTC로 통일**)
- OHLC invariant (매 캔들):
  - `high >= max(open, close)`
  - `low <= min(open, close)`
  - `high >= low`
- 공통 `drawChart(...)` 골격 + `resizeCanvas(canvas, useDPR)`
  - raw: `canvas.width === clientWidth` (정수 반올림 감안)
  - dpr: `canvas.width ≈ clientWidth * devicePixelRatio`
- 두 차트 모두 **같은** `drawChart` 호출, `useDPR`만 다름
- 배경 clear만

**확인**
- 2000개 생성, 새로고침해도 동일 시드 패턴
- raw/dpr 버퍼 너비가 위 규칙과 맞는지 (devtools)

---

### Phase 3 — 캔들 + 뷰포트 렌더

**작업**
- `getVisibleRange`, `getPriceExtent`, `indexToX`, `priceToY`
- 캔들: wick + body, 상승 녹 / 하락 빨
- 색은 파일 상단 `COLORS` 상수 (별도 theme 주입 불필요)
- 초기 viewport: `visibleCount = 500`, `startIndex = length - 500`

**확인**
- 두 차트에 같은 구간 캔들
- 정적 렌더만으로 OK

---

### Phase 4 — 축 + 최고가/최저가

**작업**
- plot 여백: 오른쪽 가격축 ~56px, 아래 시간축 ~28px, 좌/상 소량
- 가격·시간 nice ticks (§5)
- 보이는 구간 argmax(high) / argmin(low)
  - 가로 점선 + `최고 …` / `최저 …`
  - high≈low 또는 라벨 근접 시 Y 오프셋으로 분리
  - 가격축과 겹치면 텍스트를 plot 안쪽(왼쪽)으로
- 부분 노출 캔들도 extent에 포함 (§1 규칙)

**확인**
- 축·min/max 가독성
- viewport를 40개로 바꿔 그려 보면 라벨이 커 보이는지
- **HiDPI에서** 축/최고·최저 글자: DPR 적용 쪽이 더 선명한지 육안 비교 (데모 핵심)

---

### Phase 5 — 줌 / 팬 / 핀치 / 휠

**작업**
- Pointer Events (`pointerdown/move/up/cancel`, `setPointerCapture`)
- 휠: canvas에서 `addEventListener('wheel', handler, { passive: false })` + `preventDefault`
- 제스처·수식은 §4 따름
- viewport 변경은 반드시 `applyViewport` (이 단계에선 sync 기본 false여도 진입점은 동일)
- 포인터/휠 시작 시 `setActiveChart(id)`

**1포인터 상태머신**

| 상태 | 조건 | 동작 |
|------|------|------|
| `idle` | 포인터 없음 | — |
| `pending` | pointerdown 후, 누적 이동 `< 8px` | 아직 pan/zoom 미결정 |
| `lockedPan` | pending에서 먼저 `|dx| >= 8` 이고 `|dx| >= |dy|` | 이후 종료까지 좌우 팬만 |
| `lockedZoom` | pending에서 먼저 `|dy| >= 8` 이고 `|dy| > |dx|` | 이후 종료까지 상하 줌만 |

- 마우스: 주 버튼(left)만
- 락은 `pointerup` / `lostpointercapture` / `pointercancel`까지 유지
- 대각선: **먼저 임계를 넘긴 축** 우선 (동시면 `|dx| >= |dy|` → pan)

**2포인터 (핀치)**
- 두 번째 포인터 down 시: 1포인터 pan/zoom 락 취소, 핀치 스냅샷 시작
- 수식은 §4.2

**확인**
- 차트별 독립 확대/이동
- 상하 vs 좌우 드래그가 임계 후 고정되는지
- 터치(또는 개발자도구) 핀치

---

### Phase 6 — 버튼 + active 차트 (필수 UI)

**작업**
- `activeChartId` 초기값: **`'dpr'`** (오른쪽 DPR 적용 차트)
- 폴백: `activeChartId ?? 'raw'` (맞추기 등)
- 패널에 `is-active` 클래스 + 한글 배지 **`조작 중`** (필수, 선택이 아님)
- 포인터/휠/로컬 버튼 → 해당 패널을 active로
- 공통 `확대`/`축소`/`리셋`/`500개`/`40개`:
  - sync OFF → `applyViewport(activeId, ...)`
  - sync ON → `applyViewport(activeId, ..., { sync: true })` (양쪽)
- 로컬 버튼: 그 패널 id로 active 갱신 후 동일 API
- `setVisibleCount(count)`: 현재 뷰 중앙을 앵커로
- `reset()`: visibleCount=500, startIndex=`length-500`

**확인**
- 로드 직후 공통 확대 → DPR 쪽만 변경 (sync OFF)
- raw만 조작 후 공통 확대 → raw만 변경
- 500/40 프리셋 대략 일치

---

### Phase 7 — 동기화

**작업**
- `syncEnabled` (checkbox, 기본 OFF)
- `applyViewport`에 sync 분기 완성 (equal skip + `isApplyingSync`)
- `지금 맞추기`: `source = activeChartId ?? 'raw'` → other에 1회 복사 (`sync` 플래그와 무관, 단발 `applyViewport(otherId, sourceViewport, { sync: false })` 형태)

**확인**
- OFF 독립 / ON 한쪽 휠에 양쪽 반응
- 맞추기: 서로 다른 상태를 한쪽으로 정렬

---

### Phase 8 — 리사이즈 · DPR 감지 · 마무리

**작업**
- 각 캔버스(또는 패널)에 `ResizeObserver` → `resizeCanvas` + layout 재계산 + `draw`
- DPR 변경 감지 (모니터 이동 등):  
  `matchMedia(\`(resolution: ${dpr}dppx)\`)` 리스너 **또는** resize 핸들러에서 `window.devicePixelRatio` 이전값과 비교  
  → 변경 시 두 차트 버퍼/layout 갱신 + 상단 DPR 라벨 갱신
- 불필요 콘솔 제거
- `README.md`: 열기 방법, DPR=1이면 차이 거의 없음, 시드 42

**확인**
- 창 크기·DPR 라벨
- SPEC 수락 기준 1~10

---

## 3. API 시그니처 (목표)

```js
function generateCandles(count = 2000, seed = 42) { /* ... */ }

function resizeCanvas(canvas, useDPR) {
  // returns { cssW, cssH, dpr }
}

function drawChart(ctx, candles, viewport, layout) {
  // COLORS 상수 사용. raw/dpr 공통.
}

function createChart({ id, canvas, candles, useDPR }) {
  // returns {
  //   id, draw,
  //   getViewport(),
  //   // 내부 제스처는 앱의 applyViewport를 호출하도록 연결
  //   destroy() // 리스너 제거
  // }
}

// 앱 레벨 (단일 진입점)
function applyViewport(sourceId, nextViewport, options)
function setActiveChart(id)
```

`theme` 파라미터는 쓰지 않고 `COLORS` 상수로 충분하다.

---

## 4. 줌 · 팬 · 핀치 수학

### 4.1 공통 앵커 줌

```
ratioX = (pointerX - plotLeft) / plotWidth          // clamp 0..1 권장
anchorIndex = startIndex + ratioX * visibleCount

visibleCount' = clamp(visibleCount * factor, 20, length)
startIndex'   = clamp(
  anchorIndex - ratioX * visibleCount',
  0,
  length - visibleCount'
)
```

- **버튼 확대/축소**: `anchorIndex = startIndex + visibleCount / 2`, `factor = 1/1.2` (확대) 또는 `1.2` (축소)  
  — **factor < 1 → 확대(visibleCount 감소)**, `factor > 1 → 축소` 로 고정
- **상하 드래그**: `factor = exp(dy * kDrag)`  
  — dy > 0(아래로) → factor > 1 → 축소, dy < 0(위로) → 확대  
  — `kDrag` ≈ `0.005` 부터 튜닝
- plot 밖에서 시작한 드래그/휠은 무시 (히트테스트)

### 4.2 휠

```
// deltaY < 0 (위로/핀치아웃 관례) → 확대
factor = exp(deltaY * kWheel)   // kWheel ≈ 0.0015
// deltaMode는 무시하고 deltaY 픽셀 가정 (데모 단순화)
```

커서 X → `ratioX` → §4.1과 동일.

### 4.3 핀치

제스처 시작 시 스냅샷:

```
startDist = hypot(x2 - x1, y2 - y1)
startViewport = { ...viewport }
midX = (x1 + x2) / 2
anchorIndex = indexAtX(midX)  // §4.1과 동일 방식
ratioX = (midX - plotLeft) / plotWidth
```

매 move:

```
factor = startDist / currentDist
// factor < 1 → 손가락 벌림 → 확대(visibleCount 감소)
visibleCount' = clamp(startViewport.visibleCount * factor, ...)
startIndex'   = anchorIndex - ratioX * visibleCount'
```

`startVisibleCount * (startDist/currentDist)` 이므로 벌릴수록 count 감소 = 확대.

### 4.4 팬

```
deltaIndex = -dx / plotWidth * visibleCount
startIndex' = clamp(startIndex + deltaIndex, ...)
```

---

## 5. 축 nice ticks

### 가격

1. `raw = (max - min) / targetTickCount` (target ≈ 5)
2. `magnitude = 10^floor(log10(raw))`
3. residual = `raw / magnitude` → **residual 이상인 최소** 값 in `{1,2,5,10}` × magnitude = `step`  
   (항상 ≥ raw 인 nice step → 눈금 과밀 방지)
4. 첫 눈금 `ceil(min/step)*step` … `max` 이하까지
5. plot 밖 눈금은 그리지 않음

### 시간

1. `rangeMs = tEnd - tStart`, `raw = rangeMs / targetTickCount`
2. 후보(ms): 1m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 1d  
3. 선택: **`candidates.find(c => rangeMs / c <= targetTickCount)`** 없으면 마지막(1d)
4. 라벨 (UTC):
   - step ≥ 1d → `MM/DD`
   - else → `HH:mm` (값이 00:00이면 `MM/DD` 병기 가능)

데이터 epoch: `Date.UTC(2024, 0, 1, 9, 0, 0)` (§Phase 2와 동일).

---

## 6. 리스크 · 주의점

| 이슈 | 대응 |
|------|------|
| 캔들 수천 + 매 프레임 전체 루프 | `[from, toExclusive)`만 루프 |
| 터치 스크롤과 제스처 충돌 | 패널 `touch-action: none` + 차트 영역에서만 preventDefault |
| DPR 변경(창 이동) | ResizeObserver + dpr 비교/`matchMedia` |
| 텍스트 겹침 | Y 오프셋, 축과 겹치면 왼쪽 |
| 동기화 피드백 루프 | `applyViewport` 단일 진입 + equal skip + 가드 |
| 제스처 판정 흔들림 | 8px 임계 + 락 |
| `file://` | 비모듈 스크립트; 필요 시 README에 serve 안내 |

---

## 7. 일정 감각 (참고)

| Phase | 내용 | 비중 |
|-------|------|------|
| 1–2 | UI + 데이터 + DPR 버퍼 | 15% |
| 3–4 | 캔들·축·min/max (+ HiDPI 육안) | 35% |
| 5–6 | 제스처·active·버튼 | 30% |
| 7–8 | 동기화·리사이즈·README | 20% |

---

## 8. 구현 착수 순서 (실행 체크리스트)

- [ ] Phase 1: `index.html` + `styles.css` (SPEC 문구, 조작 중 배지 자리)
- [ ] Phase 2: 시드 데이터 + `resizeCanvas` + 공통 `drawChart` 골격
- [ ] Phase 3: 캔들 렌더 + 초기 500뷰
- [ ] Phase 4: 축 + 최고/최저 + HiDPI 선명도 확인
- [ ] Phase 5: 상태머신·휠·핀치 → `applyViewport`
- [ ] Phase 6: active(초기 dpr)·공통/로컬 버튼
- [ ] Phase 7: 동기화·지금 맞추기
- [ ] Phase 8: ResizeObserver·DPR 감지·README·수락 기준

---

## 9. 다음 액션

이 계획으로 **Phase 1부터 구현**한다.  
미세 튜닝(`kDrag`/`kWheel`, 캔버스 높이)은 구현 중 조정한다.
