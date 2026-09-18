# CarePass — 가족 금융 대리권 지갑 (프로토타입)

2026 AI Blockchain Challenge in Daegu 출품작 · iM뱅크 앱 내장 기능으로 설계

**라이브 데모: https://jinyanyou.github.io/carepass-prototype/**

계좌를 통째로 넘기는 위임이 아니라, AI가 감시하는 업무별·한도별 금융 대리권을 블록체인으로 증명하는 지갑입니다.
고령자·장애인처럼 금융 대리 관리가 필요한 시민과 그 가족을 위한 서비스이고,
별도 앱이 아니라 iM뱅크 앱의 한 기능으로 통합되는 형태를 전제로 디자인했습니다. iM뱅크 홈에서 CarePass로 진입합니다.

## 실행

별도 빌드나 서버 없이 동작하는 단일 HTML 파일입니다. 폰트만 CDN에서 불러오고, 오프라인이면 시스템 폰트로 폴백합니다.

```bash
start index.html      # Windows
```

## 화면 구성

왼쪽은 iM뱅크 앱 화면입니다. iM뱅크 홈에서 `CarePass`로 들어가고, 상단에서 어머니(위임자)와 딸(대리인) 계정을 전환할 수 있습니다. 헤더의 `가가` 버튼이 큰 글씨 모드, 각 화면의 `🔊` 버튼이 음성 안내입니다.

오른쪽은 데모 인스펙터로, 심사용 내부 동작 뷰입니다. AI 판단, 기관 인증, 블록체인 원장, 에스크로, 컨트랙트 다섯 가지를 볼 수 있습니다.

아래 데모 시나리오에서 기본 흐름 10종과 추가 기능 3종(접근성·은닉 SOS·iM Zero)을 원클릭으로 재생할 수 있고, `직접 조작(수동)`에서 결제 금액을 입력하면 판정이 실시간으로 바뀝니다.

## 사용자 화면과 심사 인스펙터를 나눈 이유

CarePass 앱 화면, 즉 고령자와 가족이 보는 뷰에는 쉬운 말만 노출합니다. 실시간 판정은 `안전 / 주의 / 확인 필요` 세 가지로만 표시하고 z-score나 μ·σ 같은 기술 지표는 숨깁니다. 그 판단 근거(규칙 엔진과 z-score 계산 과정)는 데모 인스펙터에서만 확인할 수 있습니다.

## 구현 범위

### Must (실제 구현)

| 항목 | 구현 방식 |
|---|---|
| 위임 설정 | 위임 풀 슬라이더 + 항목별 권한·한도 지정 UI |
| 결제요청 → AI판단 → 위임자확인 → 승인/거부 | 전체 플로우 완주 (승인 시 PIN 인증) |
| 이상탐지 | 합성 데이터 42/31건 기반 규칙 엔진 + z-score |
| 스마트컨트랙트 | Sepolia 테스트넷 배포·소스 검증 `CarePassRegistry`. 시연 초기 이력 3건을 실제로 기록했고, 화면이 `getHistory` 조회 후 SHA-256으로 대조 |
| 공공데이터 결제처 확인 | 건강보험심사평가원 요양기관 목록(대구 5,607곳)에 없는 병원비 결제처는 자동 보류 |
| 의료기관 인증 · 청구서 전자서명 | 인증 기관의 서명 공개키를 온체인 등록하고, 청구서 QR 서명을 WebCrypto ECDSA P-256으로 실제 검증. 이름만 베낀 사칭 청구서는 보류 |
| 에스크로 서브계좌 | 본계좌에서 격리된 가상 위임 풀 |

### Should (구현)

- 냉각기간 60초 타이머 (24h 축약), 제3자(신뢰인) 알림
- 생활비 보호선 미달 시 자동 보류
- 위임 이력 온체인 타임라인

### 확장 기능 (데모 구현)

- 고령자 접근성: 인앱 `가가` 큰 글씨 모드(실제 iM뱅크 앱에는 없는 기능)와 화면별 음성 안내(Web Speech API TTS)
- 은닉형 SOS: 강압 상황에서 은닉 PIN을 입력하면 겉보기엔 정상 승인되지만 실제로는 지정기관에 비공개 통보가 가고 온체인에 `sosAlert`가 남습니다
- iM Zero AI 상담: 현재 위임 상태를 반영해 쉬운 말로 답하는 챗봇입니다. 글자로 묻거나 `🎤` 음성 질문(Web Speech API 한국어 음성 인식)을 할 수 있고 답변은 음성으로 읽어줍니다. 데모는 외부 LLM을 호출하지 않는 상태 기반 답변이며, 실서비스는 iM뱅크 iM Zero와 연계하는 것을 전제로 했습니다
- 월간 대리결제 리포트: 카테고리 분해, AI 이상감지, 자연어 요약. 지자체·요양기관용 B2G 감사 리포트로도 쓸 수 있습니다
- 보안 센터: 대리인 단말 분실 시 원격 VC 폐기(revoke), 법정후견인 전환, 강화 인증

### Won't (설계 발표 · 실제 연동 필요)

실제 은행 코어 API 연동, 생체인증, 다중서명

## 스마트컨트랙트 · 블록체인 기록

| 항목 | 값 |
|---|---|
| 네트워크 | Ethereum Sepolia 테스트넷 (chainId 11155111) |
| 컨트랙트 | [`0x760394Add857d89C35FaC3220E21c1C61f0ef6A9`](https://sepolia.etherscan.io/address/0x760394Add857d89C35FaC3220E21c1C61f0ef6A9#code) (Etherscan 소스 검증 완료) |
| 기록 계정(recorder) | `0x0E00cB50396Bf3a3cdC80efab74bEaDeE501001F` |
| 시연 초기 이력 | [위임 설정](https://sepolia.etherscan.io/tx/0xcb7686a03e669409215c95e9630303e6af16080fee6f379575bad2bb5ad8754f) · [병원비 승인](https://sepolia.etherscan.io/tx/0x65485aaf2bc87cf5c277288757ef0abc393bbf39fb4e71b2be52719687090c66) · [공과금 자동승인](https://sepolia.etherscan.io/tx/0xf87a765305e54c279942ab6c39eb18edd3519fcd9e5ff09498742f66923d320f) |
| 기관 인증 발급 | [대구의료원](https://sepolia.etherscan.io/tx/0x0d2cf2f914b71e6a3c440bdf494361ed169ee9a932aa3a41f4cf70dd41ab4598) · [경북대학교병원](https://sepolia.etherscan.io/tx/0xc7234a405fa3b994d5c6a51a964ed17821fb401571f86b78f19ab562d8263c20) |
| 기관 인증 취소 | [○○재활요양병원(시연용)](https://sepolia.etherscan.io/tx/0xf33d936af0fe248b00e61a9d8cf8169f8deafc90ba460e0a9bc494fe6ba78915) (폐업·자격정지 이력) |

구조는 오프체인과 온체인을 나눴습니다. 위임 내용(VC)과 청구서 원문은 오프체인에 두고, 온체인에는 이벤트 원문의 SHA-256 해시와 기관 공개키만 올립니다. `registerDelegation`·`certifyInstitution`·`revokeInstitution`은 기록 계정만 호출할 수 있어 제3자가 가짜 이력이나 가짜 인증 기관을 끼워 넣을 수 없고, 반대로 `getHistory`·`institutionKey`는 누구나 조회해 검증할 수 있습니다.

페이지를 열면 공개 노드(publicnode)에서 `getHistory()`를 읽어, 원문(`contracts/demo-events.json`)으로 다시 계산한 해시와 대조한 뒤 인스펙터 `블록체인 원장`에 온체인 검증 결과를 표시합니다. 노드에 연결하지 못하면 로컬 기록으로 자동 전환하므로 시연이 멈추지는 않습니다.

시연 도중 새로 생기는 결제·승인 이벤트는 브라우저 로컬 원장에만 기록합니다. 실서비스라면 은행 기록 서버가 전송할 부분인데, 비밀키를 웹페이지에 넣지 않으려고 이렇게 나눴습니다. 해시는 브라우저 Web Crypto SHA-256으로 계산하고, 비보안 컨텍스트(file://)에서는 순수 JS SHA-256으로 폴백합니다.

### 컨트랙트 개발 환경 (`contracts/`)

```bash
cd contracts
npm install
npm test                 # Hardhat 자동 테스트 14건 (기록 권한·순서·위변조 탐지·기관 인증 발급/취소·서명 검증)
cp .env.example .env     # 테스트 전용 지갑 비밀키·Etherscan 키 입력 (git 제외)
node scripts/gen-institutions.js        # (최초 1회) 시연용 기관 서명키 생성 → institutions.json
npm run check:sepolia    # 기록 계정 잔액 확인
npm run deploy:sepolia   # 배포 + 기관 인증 발급/취소 + 시연 이벤트 기록 → deployments/sepolia.json
npm run verify:sepolia   # Etherscan 소스 검증
node scripts/sync-frontend.js sepolia   # index.html에 주소·tx·인증 기관 반영
```

## 공공데이터 결제처 확인

건강보험심사평가원 「전국 병의원 및 약국 현황」 2026.6. 기준 데이터를 사용했습니다. ([보건의료빅데이터개방시스템](https://opendata.hira.or.kr/op/opc/selectOpenData.do?sno=11925), 공공누리 제1유형)

여기서 대구광역시 소재 병원·의원·치과·한의원·약국 5,607곳만 추출하고(보건소·보건지소·보건진료소 제외) 기관명·종별·구군·주소·전화만 남겨 `data/daegu-medical.json`으로 가공했습니다. 페이지에도 내장해 오프라인에서 동작합니다. 가공 과정은 `python data/tools/build_daegu_medical.py "전국 병의원 및 약국 현황 2026.6.zip"`로 재현할 수 있습니다.

대리인이 병원비 결제처를 검색하면 등록 여부와 종별, 위치를 보여주고, 목록에 없는 곳이면 금액과 무관하게 임시 보류해 병원 사칭 결제를 막습니다. 시연 결제처는 공공 의료기관(대구의료원·경북대학교병원)을 썼고 사칭 예시로 나오는 `○○메디컬센터`는 가상의 이름입니다.

다만 이름 대조만으로는 부족합니다. 사기범이 결제처 이름을 그대로 베끼면 통과하기 때문에, 아래의 기관 인증과 청구서 전자서명을 한 겹 더 뒀습니다.

## 의료기관 인증 · 청구서 전자서명 (사칭 방지)

결제처 이름만 요양기관 목록과 대조하면 사기범이 이름을 `대구의료원`이라고 적는 것만으로 통과합니다. 그래서 이름 대조 위에 전자서명을 얹었습니다.

1. **최초 등록** — 병원이 CarePass에 처음 가입할 때 기관명을 요양기관 목록(`data/daegu-medical.json`)과 대조합니다. 확인되면 기관 서명키(ECDSA P-256)를 만들고 공개키를 온체인 인증 목록에 등록합니다 (`certifyInstitution`).
2. **청구서 서명** — 병원 단말이 발행하는 청구서(QR)에 기관 서명키로 전자서명합니다.
3. **결제 시 검증** — 앱이 청구서를 스캔하면 공개 노드에서 `institutionKey(instId)`로 온체인 등록 공개키를 읽어 서명을 검증합니다.
4. **인증 취소** — 폐업, 자격정지, 서명키 유출 시 `revokeInstitution`으로 인증을 취소하고 그 이력도 체인에 남깁니다.

| 청구서 | 판정 |
|---|---|
| 인증 기관이 서명한 진짜 청구서 | 서명 검증 통과 → 기존 한도·이상탐지 규칙만 적용 |
| 기관명만 베끼고 다른 키로 서명한 사칭 청구서 | 서명 불일치 → 임시 보류 (금액이 작아도 보류) |
| 청구서 금액과 요청 금액이 다른 경우 | 임시 보류 (대리인의 금액 부풀리기 차단) |
| 인증이 취소된 기관의 청구서 | 임시 보류 |
| 아직 인증받지 않은 기관 | 서명 검증 불가 → 기존과 같이 위임자 확인 후 결제 |

시연에서는 대구의료원과 경북대학교병원을 사전 인증 기관으로 뒀고, 인증 취소 이력은 실제 상호를 쓰지 않으려고 가상 기관 `○○재활요양병원(시연용)`으로 남겼습니다.

대리인 화면의 `병원 청구서 QR 스캔`에서 진짜, 사칭, 인증 취소 청구서를 골라 볼 수 있습니다. 검증 원문과 공개키, `verify()` 결과는 인스펙터 `기관 인증` 탭에 그대로 노출되고, 같은 탭에서 심사위원이 직접 기관을 인증 발급한 뒤 그 기관 청구서를 발행해 검증해 볼 수도 있습니다.

한 가지 분명히 해두면, 사칭을 실제로 막는 것은 전자서명이고 블록체인의 역할은 여러 은행·결제대행사·지자체가 함께 조회하는 인증 기관 목록과 취소 이력의 공개 장부로 한정됩니다.

`contracts/institutions.json`의 서명키는 브라우저에서 "병원 단말이 서명하는" 과정을 재현하려고 넣은 시연용 데모 키이며 보호하는 자산이 없습니다. 실서비스에서는 기관 단말의 보안영역(HSM/Secure Enclave)에 두고 앱으로 내려보내지 않습니다.

## 기술

- 단일 HTML 파일, 바닐라 JS, 외부 프레임워크 없음 (폰트만 CDN: Pretendard · Noto Sans KR · JetBrains Mono)
- Solidity 0.8.24 · Hardhat 2 (테스트·배포·Etherscan 검증) · Ethereum Sepolia 테스트넷
- 공공데이터: 건강보험심사평가원 요양기관 현황(대구)
- iM뱅크 공식 브랜드 컬러(민트 `#00c7a9`)와 Pretendard 폰트 적용
- `crypto.subtle` SHA-256 해싱 (비보안 컨텍스트는 순수 JS SHA-256 폴백), 청구서 서명·검증은 `crypto.subtle` ECDSA P-256
- 라이트/다크 테마 대응, 반응형
- 접근성: 큰 글씨 모드와 음성 안내(TTS)로 디지털 소외계층 대응

## 사용한 외부 리소스 · 라이선스

| 리소스 | 용도 | 라이선스 |
|---|---|---|
| [Pretendard](https://github.com/orioncactus/pretendard) v1.3.9 | 본문 폰트 (jsDelivr CDN) | SIL Open Font License 1.1 |
| [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) | 대체 폰트 (Google Fonts) | SIL Open Font License 1.1 |
| [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | 해시·코드 표시 (Google Fonts) | SIL Open Font License 1.1 |
| Web Speech API · Web Crypto API | 음성 안내·음성 인식, SHA-256 해시 | 브라우저 내장 표준 API |
| [Hardhat](https://hardhat.org) 2 · [ethers](https://docs.ethers.org) 6 | 컨트랙트 컴파일·테스트·배포 (`contracts/`, 개발 도구) | MIT |
| 건강보험심사평가원 「전국 병의원 및 약국 현황」 2026.6. | 결제처 확인 (대구 5,607곳 가공) | 공공누리 제1유형(출처표시) |

폰트 파일은 저장소에 포함하지 않고 CDN에서 불러옵니다. 이상탐지 학습 데이터(병원비·공과금 결제 이력)는 직접 만든 합성 데이터라 실제 개인정보가 들어 있지 않습니다. iM뱅크 브랜드 컬러는 주최사 공모전 출품용으로만 사용했고, iM 캐릭터(마스코트) 이미지는 쓰지 않았습니다.
