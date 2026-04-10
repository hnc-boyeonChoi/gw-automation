# GW Automation

한컴 그룹웨어 자동화 봇 (자연어 처리 + Okta MFA + Google Chat)

<br/>

## 개요

회사 그룹웨어(gw.hancom.com)에 자동 로그인하고, 업무 현황을 Google Chat으로 받아볼 수 있는 자동화 서비스입니다.

**해결하는 문제:**
- 매일 아침 그룹웨어 접속 → Okta MFA 인증 → 여러 페이지 확인하는 반복 작업
- 팀원 근태, 결재함, 메일, 연차 등을 한눈에 파악하기 어려움

**제공하는 가치:**
- **자연어 명령**: "팀 현황 알려줘", "연차 얼마 남았어?" 등 자연어로 조회
- **대화 기억**: "그리고 연차는?", "다시 보여줘" 같은 맥락 인식
- **빠른 응답**: API 직접 호출로 브라우저 없이 즉시 조회 (v3.0)
- Okta 푸시 알림 승인만 하면 자동으로 전체 현황 수집

<br/>

## 아키텍처

```
Google Chat 봇 (Apps Script)
    ├── 빠른 패턴 매칭 (정규식)
    ├── OpenAI GPT-4o-mini (Intent 분류)
    └── 대화 히스토리 관리
          ↓ Pub/Sub 발행
GCP Pub/Sub (gw-automation)
          ↓ Pull 구독
Node.js Worker (로컬)
    ├── v3.0 API 직접 호출 (빠름)
    ├── Playwright 브라우저 자동화 (필요시)
    └── Google Chat 응답
```

**왜 이런 구조인가?**

| 제약 | 해결 방법 |
|------|-----------|
| 회사 네트워크 인바운드 차단 | Pub/Sub Pull 방식 (아웃바운드만 사용) |
| Okta MFA 필수 | Playwright로 브라우저 자동화 + 푸시 대기 |
| 그룹웨어 API 제한 | v3.0 API 직접 호출 + Playwright 하이브리드 |

<br/>

## 기능

### 자연어 명령 (v2.1+)

| 사용자 입력 | Intent | 동작 |
|-------------|--------|------|
| "팀 현황 알려줘" | team | 팀원 근태 조회 |
| "내 연차 얼마 남았어?" | leave | 연차 현황 조회 |
| "결재할 문서 있어?" | approval | 전자결재 조회 |
| "새 공지사항 있어?" | board | 게시판 조회 |
| "안 읽은 메일 있어?" | mail | 메일 조회 |
| "오늘 브리핑 해줘" | all | 전체 브리핑 |
| "다시 보여줘" | repeat | 마지막 요청 반복 |

### v3.0 하이브리드 처리

| 요청     | 처리 방식      | 속도 |
|----------|---------------|------|
| team     | API 직접 호출  | 빠름 |
| approval | API 직접 호출  | 빠름 |
| note     | API 직접 호출  | 빠름 |
| mail     | API 직접 호출  | 빠름 |
| leave    | Playwright    | 기존 |
| board    | Playwright    | 기존 |
| budget   | Playwright    | 기존 |

### 버튼 명령어

| 명령어 | 기능 | 데이터 |
|--------|------|--------|
| `/briefing` | 전체 브리핑 | 로그인 + 아래 전체 |
| `/scrape:team` | 팀 현황 | 출근/외근/휴가/반차 |
| `/scrape:leave` | 내 연차 | 총/사용/잔여 |
| `/scrape:approval` | 전자결재 | 미결 건수 |
| `/scrape:board` | 게시판 | 안읽은 글 + 최신 글 |
| `/scrape:mail` | 메일 | 안읽은 메일 수 |
| `/scrape:budget` | 예실 | 예산/집행/잔액 |
| `/login` | 로그인만 | Okta MFA 인증 |

<br/>

## 기술 스택

- **Runtime:** Node.js
- **Browser Automation:** Playwright
- **Messaging:** GCP Pub/Sub
- **Chat Bot:** Google Apps Script
- **Process Manager:** PM2

<br/>

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 설정

```bash
# GCP 인증 (Application Default Credentials)
gcloud auth application-default login

# 서비스 계정 키 파일 배치
cp your-service-account.json ./service-account.json
```

### 3. 실행

```bash
# 개발
npm start

# 프로덕션 (PM2 데몬)
pm2 start worker.js --name gw-worker
```

<br/>

## 프로젝트 구조

```
├── worker.js              # 메인 워커 (Pub/Sub 구독 + 스크래핑)
├── api-client.js          # v3.0 API 클라이언트 (fetch 기반)
├── apps-script/
│   └── Code.gs            # Google Chat 봇 (자연어 처리)
├── docs/                  # 문서
│   ├── v2-release-notes.md
│   ├── api-reference.md
│   └── architecture.md
├── package.json
├── service-account.json   # GCP 서비스 계정 (Git 제외)
├── cookies.json           # 로그인 쿠키 (자동 생성, Git 제외)
├── userinfo.json          # 사용자 정보 (자동 생성, Git 제외)
└── .env                   # 환경 변수 (Git 제외)
```

<br/>

## GCP 설정

| 리소스 | 값 |
|--------|-----|
| 프로젝트 | `hc-prd-axtech-bot` |
| Pub/Sub 토픽 | `gw-automation` |
| Pub/Sub 구독 | `gw-automation-sub` |
| 서비스 계정 | `chatgw@hc-prd-axtech-bot.iam.gserviceaccount.com` |

<br/>

## 동작 흐름

```
1. 사용자가 Google Chat에서 "전체 브리핑" 버튼 클릭
2. Apps Script가 Pub/Sub에 메시지 발행
3. Worker가 메시지 수신
4. Playwright로 그룹웨어 로그인 시도
5. Okta 푸시 알림 발송 → 사용자 승인 대기 (최대 3분)
6. 로그인 성공 후 7개 영역 스크래핑
7. 결과를 Google Chat으로 전송
```

<br/>

## 버전

| 버전 | 주요 기능 |
|------|----------|
| v3.0 | API 직접 호출 (하이브리드) |
| v2.5 | 빠른 패턴 매칭, Unknown 응답 개선 |
| v2.3 | 대화 기억 |
| v2.1 | 자연어 명령 (OpenAI GPT-4o-mini) |
| v2.0 | Pub/Sub 아키텍처 |

자세한 내용: [Release Notes](./docs/v2-release-notes.md)

<br/>

## 라이선스

MIT
