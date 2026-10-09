# 40 — 홈 히어로: ASCII 재명세 (40d)

- 작성: designer w9:p1 · 브랜치 `feature/design` · 2026-10-09
- 대상 구현: `components/Hero/Scene.tsx`, `components/Hero/shaders/dither.ts` → **`shaders/ascii.ts`로 교체** (현재 기준 커밋 `3961dc8`)
- 레퍼런스: `public/references/40/` (목록·출처는 §8, `public/references/40/README.md`)
- 목업: `public/references/40/09-mock-globe.png`, `10-mock-sky-plane.png` — 이 문서의 수치를 그대로 CPU로 렌더한 결과(DPR 2, 1440×900). **구현 결과가 이 두 장과 톤이 같아야 한다.**
- Figma: 사용 안 함(목업은 위 CPU 렌더로 대체 — handoff 참고)

## 0. 이 phase의 비주얼 질문 → 답

| 질문 | 답 (한 줄) |
|---|---|
| 디더 방식 | Bayer 픽셀 디더 폐기. **셀 단위 ASCII glyph** — 셀 1개 = 문자 1개, 밝기 → 12단계 ramp. 디더는 ramp 단계 사이에서만 셀 단위로. |
| 톤 | **검은 바탕(#0B0B0B) + 따뜻한 회백색 글자(#E9E7E2)**. 밝은 것 = 글자 빽빽, 어두운 것 = 빈칸. 하늘은 대부분 비고, 지평선 쪽 안개·구름·비행기운만 글자로 찬다. |
| 지구 | 셀 작게(7×12 CSS px), 콘트라스트 0.92로 낮춤, 대륙 마스크 + 지형 노이즈 + 글자 밝기 2채널(밀도+명도)로 "섬세". |
| 비행기 | 땅(눈높이)에서 **55° 올려다봄**. 비행기는 고도에 놓인 실제 3D 평면도(planform)라 원근으로 아래에서 본 느낌이 생긴다. 한 번 지나가는 데 **28초**, 주기 **45초**, 화면 각도 **≈24°**(데스크톱). |
| 모션감 | 전부 느리게: intro 6.8초, 구름 드리프트는 비행기 속도의 1/18, 글자 깜빡임 없음. |

---

## 1. 셰이더 명세 — ASCII glyph atlas

### 1.1 파이프라인

```
pass 1  scene A (지구)  ─┐   렌더 타깃 크기 = (cols×2, rows×2), LinearFilter
pass 1' scene B (하늘)  ─┤   ※ B는 intro 3.4s 이후부터, A는 4.4s 이후 렌더 중단
                          ▼
pass 2  ascii.frag : 셀 중심에서 A·B 샘플(2×2 평균) → 휘도 → 보정 → ramp index → atlas 샘플 → 화면
```

- 씬 타깃을 **셀 격자의 2배 해상도**로만 렌더한다(1440×900·셀 7×12 → 205×75 셀 → 410×150 타깃). 셀 중심 샘플 1회 = 2×2 평균. 풀해상도 렌더 금지(§7).
- `renderer.toneMapping = THREE.NoToneMapping`, 씬 머티리얼은 전부 `ShaderMaterial` 또는 `MeshBasicMaterial` — **이 문서의 휘도 수치는 머티리얼이 출력하는 값 그대로**다. `MeshStandardMaterial` + 라이트 조합은 수치가 맞지 않으므로 지구는 커스텀 셰이더(§2.2)로 바꾼다.
- 타깃 텍스처 `colorSpace = NoColorSpace`(선형 값 그대로). 감마는 ascii 패스의 `uGamma` 하나로만.

### 1.2 Glyph set

| 항목 | 값 |
|---|---|
| ramp (빈 → 빽빽) | `" .,:;-=+*#%@"` — **12단계**, ASCII만 (폰트 커버리지 보장) |
| 폰트 | PP Lettra Mono **Regular 400** (`/public/fonts/PPLettraMono-Regular.otf`, 이미 `lib/fonts.ts`에 로드됨). family 이름은 next/font가 해시하므로 `getComputedStyle(document.body).fontFamily` 첫 항목을 쓴다 |
| 폰트 로딩 | atlas 생성 전 `await document.fonts.load(\`400 ${px}px ${family}\`)`. 실패 시 `ui-monospace, Menlo, monospace` |
| atlas | `<canvas>` 가로 `12 × cellW_dev`, 세로 `cellH_dev`. 흰색 글자·투명 배경, 각 글자는 셀 가로 중앙, `textBaseline="middle"`, y = `cellH_dev × 0.54`. 폰트 크기 = `round(cellH_dev × 0.86)` |
| atlas 텍스처 | `CanvasTexture`, `minFilter=magFilter=LinearFilter`, `generateMipmaps=false`, `flipY=false`(셰이더에서 y 처리) |

### 1.3 셀 크기 (CSS px → device px)

| breakpoint | 셀 W×H (CSS px) | 1440×900 기준 격자 | 지구 지름(셀) |
|---|---|---|---|
| ≥ 1024 | **7 × 12** | 205 × 75 | ≈ 80 |
| 640–1023 | **7 × 12** | — | — |
| < 640 | **6 × 10** | 390×844 → 65 × 84 | ≈ 52 |

- `uCellSize = vec2(round(cellW × dpr), round(cellH × dpr))` — **반드시 정수 device px**(소수면 격자가 아른거림).
- DPR clamp: `min(devicePixelRatio, 2)`. ASCII 패스는 싸고 씬 타깃은 셀 격자 기준이라 기존 1.5 제한은 불필요. 저사양 강등 시 1 (§6).
- 격자 원점: **화면 왼쪽 위**. 셰이더에서 `frag.y = uResolution.y - frag.y` 후 셀 계산(아래쪽 잘린 줄이 생기게 — 위쪽 잘림은 눈에 띔).

### 1.4 uniform 표 (`shaders/ascii.ts`)

| uniform | 타입 | 값 | 설명 |
|---|---|---|---|
| `uSceneA` | sampler2D | 지구 타깃 | |
| `uSceneB` | sampler2D | 하늘 타깃 | |
| `uSceneMix` | float | 0→1 (§3) | A↔B 휘도 크로스페이드 |
| `uAtlas` | sampler2D | atlas | |
| `uGlyphCount` | float | **12.0** | ramp 길이 |
| `uResolution` | vec2 | 캔버스 device px | |
| `uCellSize` | vec2 | §1.3 | device px, 정수 |
| `uBlack` | float | **0.06** | 이 아래 휘도 = 0 |
| `uWhite` | float | **0.90** | 이 위 = 1 |
| `uGamma` | float | **0.85** | <1 = 중간톤 들어올림(지구 디테일) |
| `uContrast` | float | **0.92** | 0.5 기준. 1 미만 = 덜 투박 |
| `uCut` | float | **0.035** | **보정 전** 정규화 휘도가 이 미만이면 무조건 빈칸 |
| `uDither` | float | **0.50** | ramp 한 단계의 몇 배만큼 Bayer 4×4(셀 단위) 지터 |
| `uIntensityFloor` | float | **0.40** | 글자 명도 = mix(0.40, 1, l). 밀도+명도 2채널 |
| `uInk` | vec3 | **(0.914, 0.906, 0.886)** = #E9E7E2 | |
| `uPaper` | vec3 | **(0.043, 0.043, 0.043)** = #0B0B0B | |

### 1.5 ascii.frag (그대로 써도 되는 수준)

```glsl
precision highp float;
varying vec2 vUv;
uniform sampler2D uSceneA, uSceneB, uAtlas;
uniform float uSceneMix, uGlyphCount, uBlack, uWhite, uGamma, uContrast, uCut, uDither, uIntensityFloor;
uniform vec2 uResolution, uCellSize;
uniform vec3 uInk, uPaper;

float bayer4(vec2 p) {
  vec2 q = mod(p, 4.0);
  int i = int(q.y) * 4 + int(q.x);
  // 0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
  return 0.5;
}

void main() {
  vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uResolution;      // 원점 = 왼쪽 위
  vec2 cell = floor(frag / uCellSize);
  vec2 grid = ceil(uResolution / uCellSize);
  vec2 suv  = vec2((cell.x + 0.5) / grid.x, 1.0 - (cell.y + 0.5) / grid.y);

  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  float lum = mix(dot(texture2D(uSceneA, suv).rgb, W),
                  dot(texture2D(uSceneB, suv).rgb, W), uSceneMix);

  float raw = clamp((lum - uBlack) / (uWhite - uBlack), 0.0, 1.0);
  float l   = clamp(0.5 + (pow(raw, uGamma) - 0.5) * uContrast, 0.0, 1.0);
  float n1  = uGlyphCount - 1.0;
  float ld  = clamp(l + (bayer4(cell) - 0.5) * uDither / n1, 0.0, 1.0);
  float idx = raw < uCut ? 0.0 : floor(ld * n1 + 0.5);

  vec2 inCell = fract(frag / uCellSize);
  float g = texture2D(uAtlas, vec2((idx + inCell.x) / uGlyphCount, inCell.y)).a;
  float inten = mix(uIntensityFloor, 1.0, l);
  gl_FragColor = vec4(mix(uPaper, uInk, g * inten), 1.0);
}
```

> 씬 타깃 크기는 `grid × 2`이므로 `suv`(셀 중심)는 2×2 텍셀의 정확한 꼭짓점 → LinearFilter가 자동으로 4-tap 평균을 준다.

---

## 2. 지구 (scene A) — "섬세하게"

### 2.1 지오메트리·배치

| 항목 | 값 |
|---|---|
| 구 | `SphereGeometry(1, 128, 96)` |
| 배경 | 휘도 0 (빈칸) + 별 |
| 시작 방향 | 화면 중심 = **Seoul에서 경도 −18°, 위도 −12°** 지점 → 서울은 중심의 오른쪽 위에 보임 |
| 정렬 | intro 0→3.8s 동안 회전이 `easeInOutSine`으로 **서울이 화면 정중앙**에 오도록 수렴 (자전 따로 없음, 최대 회전 속도 ≈ 9°/s — cubic은 17°/s로 너무 빠름) |
| 서울 | 37.5665° N / 126.9780° E. 별도 마커 없음(좌표는 DOM 오버레이 §5가 담당) |

### 2.2 지구 셰이더 (`earthFrag`, ShaderMaterial)

| uniform | 값 | 비고 |
|---|---|---|
| `uLandMask` | equirect 2048×1024, 1채널, 육지=1 | **Natural Earth 1:50m land 래스터(퍼블릭 도메인)** — 에셋 추가는 engineering/40c 몫(`public/textures/earth-landmask-2048.png` 제안, ≤120KB) |
| `uSunDir` | view space `normalize(-0.55, 0.45, 0.70)` | 왼쪽 위 앞에서 빛 → 오른쪽 아래에 터미네이터 |
| `uWrap` | **0.20** | `diff = clamp((dot(n,L)+w)/(1+w),0,1)` — 부드러운 터미네이터 |
| `uOceanAlbedo` | **0.36** | |
| `uLandAlbedo` | **0.82** | 육지-바다 차 0.46 → ramp 5–6단계 차이 |
| `uGrainFreq` | **48** | fbm 3옥타브, 입력 = equirect uv × 48 (구 표면에 고정 — 화면에 고정하지 말 것) |
| `uGrainAmp` | 바다 **0.05**, 육지 **0.17** | `albedo += (fbm-0.5) × mix(0.05, 0.17, land)` — 지형 음영 대용 |
| `uRimStrength` / `uRimPower` | **0.22** / **2.5** | `rim = 0.22 × (1-n·v)^2.5`, `diff`를 곱해 밤 쪽엔 없음 |
| `uAmbient` | **0.03** | 밤 반구가 완전히 빈칸은 아니게 |

`lum = albedo × diff + rim × diff + uAmbient`

- 마스크는 `smoothstep(0.35, 0.68, mask)`로 해안선을 1–2셀에 걸쳐 부드럽게(계단 현상 방지).
- 별: 배경 셀의 0.15%(`hash(halfcell) > 0.9985`), 휘도 0.55, 정적. intro 하강 단계에서 `1 - smoothstep(0, 0.5, descend)`로 사라짐.

---

## 3. 카메라 · intro 명세

### 3.1 타임라인 (prop `introDuration = 6.8`, 초)

| t (s) | stage | scene | 카메라 | easing |
|---|---|---|---|---|
| 0.0 – 1.0 | **S0 hold** | A | 지구 중심에서 **6.4R**, vfov **28°**, lookAt 중심 | 정지 (지구만 정렬 회전 중) |
| 1.0 – 3.8 | **S1 descend** | A | 거리 **6.4R → 1.12R**, vfov **28° → 38°** | `easeInOutQuart` |
| 3.4 – 4.4 | **X crossfade** | A→B | `uSceneMix` 0 → 1 | `smoothstep` |
| 3.4 – 4.4 | (B 도착) | B | pitch **8°** 고정 — 지평선 띠가 화면 아래 1/3에 보임 | — |
| 4.4 – 6.8 | **S2 look-up** | B | pitch **8° → 55°** | `easeInOutSine` |
| 6.8 → | **S3 settle** | B | pitch 55° 고정 | — |
| 6.8 – 7.4 | 좌표 페이드인 | DOM | opacity 0 → 1 | `ease-out`, 600ms |
| 8.0 | 첫 비행기 | B | §4 | — |

- 지구 6.4R·vfov 28° → 지구 지름 ≈ 화면 높이의 60% (목업 09).
- 기존 4초·cubic은 "휙" 느낌이었음 → 6.8초, 시작/끝이 더 느린 Quart/Sine.

### 3.2 scene B (하늘) 카메라

| 항목 | 데스크톱 ≥1024 | 태블릿 640–1023 | 모바일 <640 |
|---|---|---|---|
| 위치 | `(0, 0, 0)` — **눈높이, 땅 바로 위**(지면은 y<0, 그리지 않음 = 빈칸) | 같음 | 같음 |
| yaw | 0 (−Z 방향) | 0 | 0 |
| 최종 pitch | **55°** | 55° | 55° |
| vfov | **55°** | **58°** | **62°** |
| 화면 아래 끝 고도각 | 27.5° | 26° | 24° |

### 3.3 하늘 휘도 (scene B 배경, 고도각 θ 기준)

| θ | 0° | 20° | 45° | 90° |
|---|---|---|---|---|
| sky 휘도 | **0.20** | **0.11** | **0.05** | **0.00** |

- 선형 보간. θ<0(지면) = 0. → 천정은 완전히 비고, 화면 아래쪽에만 `.,` 안개.
- 구름: 고도 y=60 평면 위 world xz 좌표에 fbm 3옥타브, 스케일 `(0.018, 0.030)`, `cloud = clamp((fbm-0.56)×3.0, 0, 1) × 0.22`. 드리프트 **(+0.35, 0, −0.12) u/s** (비행기의 약 1/18).

---

## 4. 비행기 명세

### 4.1 궤적 (world, scene B, 고도 y = 60)

화면 비율 좌표는 `(x: 왼쪽=0, y: 위=0)`. world 좌표는 §3.2 카메라·최종 pitch 55° 기준으로 역투영해 계산한 값 — **world 직선을 그대로 쓰면 원근 때문에 화면 속도가 끝으로 갈수록 빨라지고 비행기도 커진다(= 아래서 올려다보는 느낌의 핵심).** 화면 공간 선형 트윈 금지.

| breakpoint | 화면 시작 → 끝 | 화면 각도 | world 시작 | world 끝 | 길이 |
|---|---|---|---|---|---|
| ≥1024 (1440×900) | (−0.08, 0.91) → (1.12, 0.06) | **23.9°** | (−100.94, 60, −96.45) | (57.28, 60, −11.00) | 179.8 |
| 640–1023 (1024×1366) | (−0.10, 0.80) → (1.10, 0.22) | **32.8°** | (−47.61, 60, −80.78) | (30.00, 60, −19.21) | 99.1 |
| <640 (390×844) | (−0.12, 0.72) → (1.12, 0.28) | **37.5°** | (−30.95, 60, −71.02) | (21.28, 60, −22.07) | 71.6 |

- 다른 화면비에서는 같은 화면 비율 시작/끝을 카메라에서 역투영해 y=60 평면과 교차시킨다(resize마다 재계산, 공식: `P = dir × 60 / dir.y`).
- 위치: `P(k) = mix(start, end, k)`, `k = tPass / airplanePassDuration` **선형(world)**.

### 4.2 타이밍

| prop | 값 | 비고 |
|---|---|---|
| `airplanePassDuration` | **28 s** | 화면 평균 ≈ 62 px/s(1440). 기존 10s 대비 2.8배 느림 |
| `airplaneInterval` | **45 s** | 주기(시작→다음 시작). 비행기 없는 빈 하늘 17초 포함 — 비운이 다 사라질 시간 |
| 첫 출현 | t = 8.0 s | intro 끝 후 1.2s |

화면 위치 체크(데스크톱): k=0 → (−0.08, 0.91) · 0.25 → (0.10, 0.78) · 0.5 → (0.34, 0.62) · 0.75 → (0.66, 0.39) · 1 → (1.12, 0.06).

### 4.3 메시 (planform, 아래에서 본 평면도)

`THREE.ShapeGeometry`를 XZ 평면에 눕혀(`rotateX(-π/2)`) 고도 60에 두고 `side: DoubleSide`. 진행 방향으로 yaw(`atan2(dir.x, −dir.z)`, 데스크톱 ≈ 118.4°). 단위 = 날개폭 S 배수, 앞 = +along.

| 부위 | 형태 |
|---|---|
| 동체 | 폭 0.09S, along −0.50 … +0.55 |
| 주익 | 앞전 `along = 0.08 − |lat|·tan28°`, 시위 `0.16 − 0.10|lat|`, lat ±0.50 |
| 수평미익 | 앞전 `along = −0.36 − |lat|·tan32°`, 시위 0.09, lat ±0.18 |
| 휘도 | **0.97** (`MeshBasicMaterial`, color 0.97) → `@%#` |

| breakpoint | 날개폭 S (world) | 화면 날개폭 (k=0 → 1) | 셀 수 |
|---|---|---|---|
| ≥1024 | **12.0** | 108 → 179 px | 15 → 26 |
| 640–1023 | **9.0** | 114 → 162 px | 16 → 23 |
| <640 | **7.0** | 53 → 71 px | 9 → 12 |

### 4.4 비행운 (contrail) — 리본 메시, 선(Line) 금지

| 항목 | 값 / 공식 |
|---|---|
| 개수 | 2줄, lat **±0.18S** |
| 시작 | 비행기 중심 뒤 **0.6S** (꼬리 바로 뒤 간격) |
| age 샘플 | `age_i = i × 0.25s`, i = 0…55 → **segments 56** (줄당) |
| 위치 | `C_i = P(k − age_i / passDuration) − dir × 0.6S + side × (±0.18S + 0.04S × age_i)` — **비행기와 같은 P(k)에서 파생**(머리가 비행기에 붙어 다님) |
| 반폭 | `w(age) = 0.030S × (1 + 2.5 × age / τ)` |
| 휘도 | `0.85 × exp(−age / τ) × smoothstep(maxAge, maxAge − 3, age)` |
| τ / maxAge | **9 s / 14 s** (기본). 화면상 길이 ≈ 14 × 62 px ≈ 870px (데스크톱) |
| 최소 폭 | 화면에서 **≥ 1.5셀**(가까운 끝 기준). 미만이면 반폭 clamp |
| k − age/T < 0 | 그 세그먼트 숨김 (출현 직후엔 짧게 자라남) |

### 4.5 스크롤 "늘어짐" (기존 요구 유지, 완화)

| 항목 | 값 |
|---|---|
| `scrollNorm` | `clamp(−rect.top / rect.height, 0, 1)` |
| 스무딩 | `s += (target − s) × (1 − exp(−6·dt))` |
| 비행기 scrub | `k_eff = k + 0.25 × s` |
| 비운 늘어짐 | `τ × (1 + 1.2s)`, `maxAge × (1 + 1.0s)` |

---

## 5. 좌표 오버레이

> 디자인 안 투표 결과 기록을 ops 폴더에서 찾지 못함 → 아래는 **가정**(handoff에 명시). 투표 결과가 다르면 위치·크기만 바꾸면 된다.

| 항목 | 값 |
|---|---|
| 요소 | 캔버스 밖 **DOM 텍스트**(SSR, 선택 가능), `aria-hidden` 아님 |
| 텍스트 | `37.5665° N / 126.9780° E` (한 줄) |
| 위치 | **왼쪽 아래**. 데스크톱 left 40px / bottom 40px · 모바일 left 24px / bottom `calc(24px + env(safe-area-inset-bottom))` — 비행기 진입점(왼쪽 아래)과는 비행기가 지나갈 때만 잠깐 겹침, 글자는 위에 그림(z-index) |
| 폰트 | PP Lettra Mono Regular 400, `font-variant-numeric: tabular-nums` |
| 크기 | 데스크톱 **12px**, 모바일 **11px**, line-height 1 |
| letter-spacing | **0.08em** |
| 색 | `rgba(233, 231, 226, 0.72)` (#E9E7E2 72%) on #0B0B0B → 대비 ≈ 8.4:1 |
| 등장 | t 6.8 → 7.4s opacity 0→1. reduced-motion이면 처음부터 1 |

---

## 6. 반응형 · 접근성 · 폴백

| 상태 | 동작 |
|---|---|
| SSR / JS 전 | 히어로 컨테이너 `background:#0B0B0B` + 정적 폴백 이미지 + 좌표 DOM. **흰 화면 깜빡임 금지** |
| `prefers-reduced-motion: reduce` | intro 생략, scene B·pitch 55°, 비행기 **k = 0.42** 정지 + 그 시점 비운, 구름 정지, 스크롤 반응 없음. 1프레임 렌더 후 rAF 정지(resize 때만 재렌더) |
| WebGL 미지원 | 정적 폴백 이미지 |
| 저사양 사전 판정 | `navigator.connection?.saveData` 또는 (`hardwareConcurrency ≤ 4` && `deviceMemory ≤ 4`) → 정적 폴백 |
| FPS 워치독 | intro 시작 후 측정. 평균 < 24fps 2초 → **1단계 강등**(dpr 1, 셀 +1px) → 그래도 < 24fps 3초 → 정적 폴백 |
| 정적 폴백 에셋 | 이 셰이더로 reduced-motion 상태를 캡처한 `hero-ascii-desktop.webp`(1440×900, ≤150KB) · `hero-ascii-mobile.webp`(780×1688, ≤120KB). 생성은 engineering/40c. 그 전까지 `10-mock-sky-plane.png` 톤 참고 |
| 접근성 | 컨테이너 `role="img"` + `aria-label="서울 상공, 아래에서 올려다본 하늘을 비행기가 천천히 가로지르는 ASCII 애니메이션"`. canvas는 `aria-hidden` |
| 탭 비활성 | `document.hidden`이면 rAF 정지, 복귀 시 시간 이어붙이기(비행기가 순간이동하지 않게 `tSec`를 일시정지 시간만큼 빼기) |

---

## 7. 하지 말 것

1. **픽셀 단위 디더(Bayer/노이즈) 금지.** 디더는 셀 단위로 ramp 단계 사이에서만. 픽셀 디더 + 글자는 둘 다 뭉개진다.
2. **콘트라스트로 검정을 들어올리지 말 것.** `uContrast < 1`을 0.5 기준으로 걸면 휘도 0이 0.04가 돼 하늘 전체가 `.` 격자(스크린 도어)로 덮인다 — 목업 1차에서 실제로 발생. 빈칸 판정은 **보정 전 raw**(`uCut`)로.
3. **1px `THREE.Line` 비운 금지.** 셀 샘플링에서 사라졌다 나타났다 깜빡인다. 리본 ≥ 1.5셀 폭.
4. **비운을 별도 타이머·지연 lerp로 따라가게 하지 말 것.** 머리가 비행기보다 뒤처져 보인다. 비운 = 같은 `P(k)`에서 age로 파생.
5. **화면 공간 직선 트윈 금지.** 스티커가 미끄러지는 느낌. world 고도 평면 직선 + 원근 투영.
6. **빠른 통과(<20s)·45° 이상 대각선 금지**(데스크톱). 사용자가 "사악" 느낌을 거절함.
7. **셀 < 6 CSS px 금지**(글자로 안 읽히고 노이즈가 됨), **> 9 CSS px 금지**(투박해짐).
8. **폰트 로드 전 atlas 생성 금지.** 대체 폰트 메트릭으로 굳는다.
9. **소수 device px 셀 금지.** 스크롤·리사이즈 때 격자가 아른거림.
10. **글자 랜덤 깜빡임·매 프레임 노이즈 금지.** 노이즈는 표면/world에 고정, 움직임은 구름 드리프트뿐.
11. **지구 빠른 자전 금지**(정렬 회전 최대 ≈ 9°/s, 이후 정지).
12. **별 과밀 금지**(0.15%).
13. **좌표를 캔버스에 그리지 말 것**(SSR·선택·스크린리더 불가).
14. **밝은 하늘 배경 금지.** 이전 버전(하늘 0.55–0.95)은 글자로 바꾸면 화면 전체가 `%@`로 꽉 찬다.
15. **씬을 풀해상도로 렌더하지 말 것.** 셀 격자×2면 충분 — 그 이상은 성능 낭비 + 평균이 안 맞음.
16. **종이·천공 질감 금지**(이전 결정 유지).

---

## 8. 레퍼런스 (cosmos.so 중심)

검색: cosmos.so 공개 GraphQL `search(searchTerm)` — 쿼리 `ascii dither earth`, `ascii globe`, `ascii airplane`, `ascii sky`, `dithered globe`, `halftone earth`, `ascii shader`, `ascii art`, `airplane from below`, `contrail sky` 결과 120개 중 8개 선별. 파일은 560px 썸네일(각 ≤ 360KB).

| # | 파일 | 출처 | 좋은 점 | 다른 점 / 안 가져올 것 |
|---|---|---|---|---|
| 1 | `01-globe-dotmatrix.png` | https://www.cosmos.so/e/361641615 | 검은 바탕 점 격자 구 — 밀도+명도 2채널, 터미네이터가 부드러움. **"섬세함"의 기준** | 점이지 글자가 아님, 위경도 곡선 격자 |
| 2 | `02-globe-ascii-circle.png` | https://www.cosmos.so/e/1536358668 | ASCII 지구, 지름 ≈ 70글자 — 우리 7×12 셀(지구 ≈ 80셀)과 비슷한 밀도 | 컬러(파랑·노랑), 원 테두리선 |
| 3 | `03-globe-sparse-dots.png` | https://www.cosmos.so/e/302348461 | 낮은 콘트라스트, 밤 반구가 거의 비어 있는 절제 | 너무 희미해 대륙이 안 읽힘 — 우리는 육지 0.82로 더 밝게 |
| 4 | `04-globe-glyph-land.png` | https://www.cosmos.so/e/1819360516 | 육지/바다를 다른 글자 밀도로 구분 | 파란 배경, 셀이 커서 투박 — **피할 예** |
| 5 | `05-contrail-diagonal.png` | https://www.cosmos.so/e/1382769113 | 아래서 본 비운 2줄이 곧게 뻗는 대각선, 비행기는 점처럼 작음 | 사진, 밝은 하늘 |
| 6 | `06-plane-high-small.png` | https://www.cosmos.so/e/2139042093 | 화면 아래 구름 띠 + 높고 작은 비행기 + 긴 비운 = 고도감·느림 | 사진. 각도 ≈ 25–30°로 우리 24°와 비슷 |
| 7 | `07-halftone-clouds.png` | https://www.cosmos.so/e/1539350611 | 흑백 하프톤 구름 — 지평선 안개 톤 | 하프톤 점(우리는 글자), 너무 밝음 |
| 8 | `08-ascii-ramp-on-black.png` | https://www.cosmos.so/e/680293491 | 검은 바탕 ASCII ramp `.:'"d@` 계열, 여백이 많은 구성 | 다른 문자셋(소문자 섞임) |
| 9 | `09-mock-globe.png` | 자체 목업(이 명세 수치) | S0 상태 톤 기준 | 지형 마스크는 임시(실제는 Natural Earth) |
| 10 | `10-mock-sky-plane.png` | 자체 목업(이 명세 수치) | S3 + 비행기 k=0.42 + 좌표 | 구름 노이즈는 CPU 근사 |

기술 레퍼런스: [react-postprocessing ASCII effect](https://react-postprocessing.docs.pmnd.rs/effects/ascii)(canvas atlas + 휘도→글자, 기본 셀 16px — 우리는 7), [vfx-js AsciiEffect](https://amagi.dev/vfx-js/docs/classes/_vfx-js_effects.AsciiEffect.html)(ramp 단계 사이 Bayer 디더 — §1.5와 같은 방식), [three.js forum: ASCII post-processing](https://discourse.threejs.org/t/asci-threejs-post-processing/89064).

---

## 9. Scene.tsx 재튜닝 체크리스트 (engineering용 요약)

| 현재 (`3961dc8`) | → 이 명세 |
|---|---|
| `dither.ts` Bayer 8×8, `uPixelSize 3`, `uContrast 1.15` | `ascii.ts` §1.4–1.5 (`uCellSize`, `uGamma 0.85`, `uContrast 0.92`, `uCut`, `uDither`, `uAtlas`…) |
| 씬 타깃 = 화면 해상도 | 셀 격자 × 2 |
| clear 검정 + 하늘 0.55–0.95 | 바탕 #0B0B0B, 하늘 §3.3 (천정 0) |
| 지구 `MeshStandardMaterial` + 라이트 | `earthFrag` §2.2 + 대륙 마스크 |
| `introDuration=4`, cubic, 단일 씬 lerp | 6.8s, §3.1 stage 표, 씬 A/B 크로스페이드 |
| 카메라 끝 `(0,1.02,0.9)` look `(0,2.2,−1.5)` | scene B 원점, pitch 8°→55°, vfov 55/58/62 |
| `airplaneInterval=10`, 경로 −2.2…2.4, ~45° | pass 28s · interval 45s · §4.1 world 경로 |
| 삼각형 실루엣 + `lookAt(camera)` | planform §4.3, 고도 평면에 눕힘(빌보드 아님) |
| `THREE.Line` 48 seg | 리본 2줄 × 56 seg §4.4 |
| DPR ≤ 1.5 | DPR ≤ 2, 강등 시 1 |
| reduced-motion: progress 0.5 | k = 0.42 정지, rAF 정지 |
