# CarePass — 가족 금융 대리권 지갑 (프로토타입)

> 2026 AI Blockchain Challenge in Daegu · 해커톤 프로토타입 · **iM뱅크 앱 내장 기능**

### ▶ 라이브 데모 : **https://jinyanyou.github.io/carepass-prototype/**

계좌 전체 위임이 아닌, **AI가 감시하는 업무별·한도별 금융 대리권**을 블록체인으로 증명하는 지갑.
고령자·장애인 등 금융 대리 관리가 필요한 시민과 그 가족을 위한 서비스로,
**iM뱅크 앱의 한 기능**으로 통합되는 형태로 디자인했습니다. iM뱅크 홈에서 CarePass로 진입합니다.

## 🔗 라이브 데모

**https://jinyanyou.github.io/carepass-prototype/**

## 실행

별도 빌드/서버 없이 동작하는 단일 HTML 파일입니다. (폰트만 CDN에서 불러오며, 오프라인이면 시스템 폰트로 폴백)

```bash
start index.html      # Windows
```

## 화면 구성

- **왼쪽 (폰)** — iM뱅크 앱 화면. iM뱅크 홈 → `CarePass` 기능 진입. 상단에서 `어머니(위임자) ↔ 딸(대리인)` iM뱅크 로그인 계정 전환. 헤더의 `가가` 버튼으로 **큰 글씨 모드**, 각 화면의 `🔊` 버튼으로 **음성 안내**.
- **오른쪽 (데모 인스펙터)** — 심사용 내부 동작 뷰 (AI 판단 / 블록체인 원장 / 에스크로 / 컨트랙트).
- **데모 시나리오** — `기본 흐름` 9종 + `추가 기능` 3종(접근성·은닉 SOS·iM Zero) 원클릭 재생. `직접 조작(수동)`에서 심사위원이 결제 금액을 직접 입력하면 판정이 실시간으로 바뀝니다.

## 사용자 화면 vs 심사 인스펙터

CarePass 앱 화면(고령자·가족이 보는 뷰)에는 **쉬운 말만** 노출합니다 — 실시간 판정은 `안전 / 주의 / 확인 필요`로만 표시하고, z-score·μ·σ 같은 기술 지표는 숨깁니다. 그 근거(규칙 엔진 + z-score 계산 과정)는 **데모 인스펙터**에서만 확인할 수 있습니다.

## 구현 범위

### Must (실제 구현)
| 항목 | 구현 방식 |
|---|---|
| 위임 설정 | 위임 풀 슬라이더 + 항목별 권한·한도 지정 UI |
| 결제요청 → AI판단 → 위임자확인 → 승인/거부 | 전체 플로우 완주 (승인 시 PIN 인증) |
| 이상탐지 | 합성 데이터 42/31건 기반 규칙 엔진 + z-score |
| 스마트컨트랙트 | **Sepolia 테스트넷 배포·소스 검증** `CarePassRegistry` — 시연 초기 이력 3건 실기록, 화면이 `getHistory` 조회 후 SHA-256 대조 |
| 공공데이터 결제처 확인 | 건강보험심사평가원 요양기관 목록(대구 5,607곳)에 없는 병원비 결제처는 자동 보류 |
| 에스크로 서브계좌 | 본계좌서 격리된 가상 위임 풀 |

### Should (구현)
- 냉각기간 60초 타이머 (24h 축약) · 제3자(신뢰인) 알림
- 생활비 보호선 미달 시 자동 보류
- 위임 이력 온체인 타임라인

### 확장 기능 (데모 구현)
- **고령자 접근성** — 인앱 `가가` 큰 글씨 모드(실제 iM뱅크 앱엔 없는 기능) + 화면별 음성 안내(Web Speech API TTS)
- **은닉형 SOS** — 강압 상황용 은닉 PIN 입력 시 겉보기엔 정상 승인, 실제로는 지정기관 비공개 통보 + 온체인 `sosAlert` 기록
- **iM Zero AI 상담** — 현재 위임 상태를 반영해 쉬운 말로 답하는 챗봇. 글자 입력 또는 🎤 **음성 질문**(Web Speech API 음성 인식, 한국어) → 답변을 음성으로 읽어줌. 데모는 외부 LLM 호출 없이 상태 기반 답변(실서비스는 iM뱅크 iM Zero 연계)
- **월간 대리결제 리포트** — 카테고리 분해·AI 이상감지·자연어 요약, 지자체·요양기관용 B2G 감사 리포트
- **보안 센터** — 대리인 단말 분실 시 원격 VC 폐기(revoke) · 법정후견인 전환 · 강화 인증

### Won't (설계 발표 · 실제 연동 필요)
- 실제 은행 코어 API 연동, 생체인증, 다중서명

## 스마트컨트랙트 · 블록체인 기록

| 항목 | 값 |
|---|---|
| 네트워크 | Ethereum **Sepolia** 테스트넷 (chainId 11155111) |
| 컨트랙트 | [`0x9fDa394DfeF9a7B8AF637c9620c5ce8ad8751A1a`](https://sepolia.etherscan.io/address/0x9fDa394DfeF9a7B8AF637c9620c5ce8ad8751A1a#code) — Etherscan 소스 검증 완료 |
| 기록 계정(recorder) | `0x0E00cB50396Bf3a3cdC80efab74bEaDeE501001F` |
| 시연 초기 이력 | [위임 설정](https://sepolia.etherscan.io/tx/0x41b7565802478b9120acb7a69a0732ebcdd9e3d525f63d8b5bd6c97610c25056) · [병원비 승인](https://sepolia.etherscan.io/tx/0x5ca6c2d7c72331391ea375d1e8799ed78013ec40003133852087ee3282ca4fee) · [공과금 자동승인](https://sepolia.etherscan.io/tx/0x22787b75c85f5c5e693729a5353a3c6c7c5f1e46730c636555e574bf861f7761) |

- **구조**: 위임 내용(VC)은 오프체인, 이벤트 원문의 **SHA-256 해시만 온체인**. `registerDelegation`은 기록 계정만 호출할 수 있어 제3자가 가짜 이력을 끼워 넣지 못하고, `getHistory`는 누구나 조회·검증할 수 있습니다.
- **화면 검증**: 페이지를 열면 공개 노드(publicnode)에서 `getHistory()`를 읽고, 원문(`contracts/demo-events.json`)으로 다시 계산한 해시와 대조해 인스펙터 `블록체인 원장`에 **온체인 검증**을 표시합니다. 노드에 연결하지 못하면 로컬 기록으로 자동 전환해 시연은 멈추지 않습니다.
- **데모 범위**: 시연 중 새로 생기는 결제·승인 이벤트는 브라우저 로컬 원장에만 기록합니다(실서비스는 은행 기록 서버가 전송). 비밀키를 웹페이지에 넣지 않기 위한 설계입니다.
- 해시는 브라우저 **Web Crypto SHA-256**으로 계산하며, 비보안 컨텍스트(file://)에서는 순수 JS SHA-256으로 폴백합니다.

### 컨트랙트 개발 환경 (`contracts/`)

```bash
cd contracts
npm install
npm test                 # Hardhat 자동 테스트 6건 (기록 권한·순서·빈 해시·위·변조 탐지·ID 분리)
cp .env.example .env     # 테스트 전용 지갑 비밀키·Etherscan 키 입력 (git 제외)
npm run check:sepolia    # 기록 계정 잔액 확인
npm run deploy:sepolia   # 배포 + 시연 이벤트 기록 → deployments/sepolia.json
npm run verify:sepolia   # Etherscan 소스 검증
node scripts/sync-frontend.js sepolia   # index.html에 주소·tx 반영
```

## 공공데이터 결제처 확인

- **데이터**: 건강보험심사평가원 「전국 병의원 및 약국 현황」 2026.6. 기준 ([보건의료빅데이터개방시스템](https://opendata.hira.or.kr/op/opc/selectOpenData.do?sno=11925), 공공누리 제1유형)
- **가공**: 대구광역시 소재 병원·의원·치과·한의원·약국 **5,607곳**만 추출(보건소·보건지소·보건진료소 제외), 기관명·종별·구군·주소·전화만 사용 → `data/daegu-medical.json` (페이지에도 내장해 오프라인에서 동작)
- **재현**: `python data/tools/build_daegu_medical.py "전국 병의원 및 약국 현황 2026.6.zip"`
- **동작**: 대리인이 병원비 결제처를 검색하면 등록 여부·종별·위치를 보여주고, 목록에 없는 곳이면 금액과 무관하게 **임시 보류**해 병원 사칭 결제를 막습니다.
- 시연 결제처는 공공 의료기관(대구의료원·경북대학교병원)을 사용하고, 사칭 예시 `○○메디컬센터`는 가상의 이름입니다.

## 기술

- 단일 HTML 파일 · 바닐라 JS · 외부 프레임워크 없음 (폰트만 CDN: Pretendard · Noto Sans KR · JetBrains Mono)
- Solidity 0.8.24 · Hardhat 2 (테스트·배포·Etherscan 검증) · Ethereum Sepolia 테스트넷
- 공공데이터: 건강보험심사평가원 요양기관 현황(대구)
- iM뱅크 공식 브랜드 컬러(민트 `#00c7a9`) 반영 · Pretendard 폰트
- 실제 `crypto.subtle` SHA-256 해싱 (비보안 컨텍스트는 순수 JS SHA-256 폴백)
- 라이트/다크 테마 대응 · 반응형
- 접근성: 큰 글씨 모드 + 음성 안내(TTS)로 디지털 소외계층 대응

## 사용한 외부 리소스 · 라이선스

| 리소스 | 용도 | 라이선스 |
|---|---|---|
| [Pretendard](https://github.com/orioncactus/pretendard) v1.3.9 | 본문 폰트 (jsDelivr CDN) | SIL Open Font License 1.1 |
| [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) | 대체 폰트 (Google Fonts) | SIL Open Font License 1.1 |
| [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | 해시·코드 표시 (Google Fonts) | SIL Open Font License 1.1 |
| Web Speech API · Web Crypto API | 음성 안내·음성 인식, SHA-256 해시 | 브라우저 내장 표준 API |
| [Hardhat](https://hardhat.org) 2 · [ethers](https://docs.ethers.org) 6 | 컨트랙트 컴파일·테스트·배포 (`contracts/`, 개발 도구) | MIT |
| 건강보험심사평가원 「전국 병의원 및 약국 현황」 2026.6. | 결제처 확인 (대구 5,607곳 가공) | 공공누리 제1유형(출처표시) |

- 폰트 파일은 저장소에 포함하지 않고 CDN에서 불러옵니다.
- 이상탐지 학습 데이터(병원비·공과금 결제 이력)는 직접 만든 합성 데이터이며, 실제 개인정보는 포함하지 않습니다.
- iM뱅크 브랜드 컬러는 주최사 공모전 출품용으로만 사용했으며, iM 캐릭터(마스코트) 이미지는 사용하지 않았습니다.
