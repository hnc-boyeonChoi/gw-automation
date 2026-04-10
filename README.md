# GW Automation

한컴 그룹웨어 자동화 봇 (Okta MFA + Google Chat + Pub/Sub)

<br/>

## 개요

회사 그룹웨어(gw.hancom.com)에 자동 로그인하고, 업무 현황을 Google Chat으로 받아볼 수 있는 자동화 서비스입니다.

**해결하는 문제:**
- 매일 아침 그룹웨어 접속 → Okta MFA 인증 → 여러 페이지 확인하는 반복 작업
- 팀원 근태, 결재함, 메일, 연차 등을 한눈에 파악하기 어려움

**제공하는 가치:**
- Google Chat에서 버튼 클릭 한 번으로 모닝 브리핑
- Okta 푸시 알림 승인만 하면 자동으로 전체 현황 수집

<br/>

## 아키텍처

```
Google Chat 봇 (Apps Script)
    ↓ Pub/Sub 발행
GCP Pub/Sub (gw-automation)
    ↓ Pull 구독
Node.js Worker (로컬)
    ├── Playwright 브라우저 자동화
    ├── 그룹웨어 스크래핑
    └── Google Chat 응답
```

**왜 이런 구조인가?**

| 제약 | 해결 방법 |
|------|-----------|
| 회사 네트워크 인바운드 차단 | Pub/Sub Pull 방식 (아웃바운드만 사용) |
| Okta MFA 필수 | Playwright로 브라우저 자동화 + 푸시 대기 |
| 그룹웨어 API 제한 | 웹 스크래핑 + 내부 API 조합 |

<br/>

## 기능

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
├── apps-script/
│   └── Code.gs            # Google Chat 봇
├── package.json
├── service-account.json   # GCP 서비스 계정 (Git 제외)
├── cookies.json           # 로그인 쿠키 (자동 생성, Git 제외)
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

## 라이선스

MIT
