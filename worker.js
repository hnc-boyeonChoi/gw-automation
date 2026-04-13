require('dotenv').config();
const { PubSub } = require('@google-cloud/pubsub');
const { chromium } = require('playwright');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { GwApiClient } = require('./api-client');

// ========== v4.1: RAG API (대화 히스토리 지원) ==========
const RAG_API_URL = 'http://172.19.0.129:8501';

async function askRag(question, conversationHistory = []) {
  try {
    log('RAG', `질문: ${question}, 히스토리: ${conversationHistory.length}개`);

    // v4.1: 원본 질문만 전송 (히스토리는 별도 필드로)
    // 히스토리를 질문에 합치면 RAG 검색이 혼란스러워짐
    const response = await fetch(`${RAG_API_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,  // 원본 질문만
        conversation_history: conversationHistory  // 별도 전달 (RAG API에서 필요시 활용)
      }),
    });

    if (!response.ok) {
      throw new Error(`RAG API 응답 에러: ${response.status}`);
    }

    const data = await response.json();
    log('RAG', `답변 수신 완료, 출처: ${data.sources?.length || 0}개`);
    return {
      answer: data.answer,
      sources: data.sources || []
    };
  } catch (error) {
    log('RAG', `에러: ${error.message}`);
    return {
      answer: `❌ RAG 서버 연결 실패: ${error.message}`,
      sources: []
    };
  }
}

// ========== 설정 ==========
const CONFIG = {
  // GCP
  PROJECT_ID: 'hc-prd-axtech-bot',
  SUBSCRIPTION_NAME: 'gw-automation-sub',
  SERVICE_ACCOUNT_PATH: path.join(__dirname, 'service-account.json'),

  // 그룹웨어
  GW_URL: 'https://gw.hancom.com/',
  COOKIE_PATH: path.join(__dirname, 'cookies.json'),
  MFA_WAIT_TIMEOUT: 3 * 60 * 1000, // 3분

  // API URLs (Worker 프로젝트 기준)
  API: {
    EMP_LIST: 'https://gw.hancom.com/ekp/service/organization/selectEmpList',
    LEAVE_BALANCE: 'https://gw.hancom.com/ekp/service/attend/selectMyHolidayYearList',
    BUDGET: 'https://gw.hancom.com/ekp/service/budget/selectBudgetAmtList',
    BOARD: 'https://gw.hancom.com/ekp/service/openapi/rss/brdArticleList',
    BOARD_IDS: {
      '공지사항': 'BBN',
      '신규입사자': 'BB299724477596798154732',
      '경조사': 'BB25990569415205958200',
      '자유게시판': 'BB25990570551270266904',
    },
    NOTE: 'https://gw.hancom.com/ekp/service/not/selectNoteList',
    MAIL: 'https://gw.hancom.com/ekp/service/openapi/rss/allUnReadMailCnt?dataType=xml&sysMenuMode=1&sessionFromServer=Y',
    APPROVAL: 'https://gw.hancom.com/ekp/service/openapi/rss/eappTodoList',
  },

  BOARD_EXCLUDE: ['그룹사 뉴스 모니터링'],
};

// 근태 상태 분류 (empAtnStatus 값)
const ATN_STATUS = {
  working: ['출근', '재실', '근무'],
  offWork: ['퇴근'],
  leave: ['휴가', '연차', '월차', '경조휴가', '병가', '출산휴가', '육아휴직'],
  outside: ['외근', '출장', '외출'],
  halfDay: ['반차', '오전반차', '오후반차'],
  health: ['건강검진'],
  absent: ['결근', '미출근'],
};

// ========== 유틸 ==========
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(tag, ...args) {
  const timestamp = new Date().toLocaleString('ko-KR');
  console.log(`[${timestamp}] [${tag}]`, ...args);
}

// ========== Google Chat ==========
async function getChatClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });
  const authClient = await auth.getClient();
  return google.chat({ version: 'v1', auth: authClient });
}

async function sendChatMessage(spaceId, text) {
  try {
    const chat = await getChatClient();
    await chat.spaces.messages.create({
      parent: spaceId,
      requestBody: { text },
    });
    log('Chat', '메시지 전송 완료');
  } catch (err) {
    log('Chat', '메시지 전송 실패:', err.message);
  }
}

// v4.1: 카드 형식 메시지 전송 (RAG 응답용, UI 개선)
async function sendChatCard(spaceId, title, answer, sources) {
  try {
    const chat = await getChatClient();

    // 출처 버튼 생성 (URL이 있는 것만, 최대 5개)
    const sourceButtons = sources
      .filter(s => s.url)
      .slice(0, 5)
      .map(s => ({
        text: (s.title || '문서 보기').substring(0, 25),
        onClick: {
          openLink: { url: s.url }
        }
      }));

    const card = {
      cardsV2: [{
        cardId: 'ragCard',
        card: {
          header: {
            title: title,
            subtitle: `v4.1 온보딩 가이드 · 출처 ${sources.length}개`
          },
          sections: [
            {
              widgets: [{
                textParagraph: { text: answer }
              }]
            }
          ]
        }
      }]
    };

    // 출처 버튼이 있으면 섹션 추가
    if (sourceButtons.length > 0) {
      card.cardsV2[0].card.sections.push({
        header: '📎 참고 문서',
        collapsible: true,
        uncollapsibleWidgetsCount: 1,
        widgets: [{
          buttonList: { buttons: sourceButtons }
        }]
      });
    }

    await chat.spaces.messages.create({
      parent: spaceId,
      requestBody: card,
    });
    log('Chat', '카드 메시지 전송 완료');
  } catch (err) {
    log('Chat', '카드 전송 실패:', err.message);
    // 실패시 텍스트로 전송
    await sendChatMessage(spaceId, `📚 *${title}*\n\n${answer}`);
  }
}

// ========== 로그인 ==========
async function doLogin(task, options = {}) {
  const { returnBrowser = false } = options;
  const { username, spaceId } = task;
  log('Login', `시작: ${username}`);

  const browser = await chromium.launch({
    headless: false,
    ignoreHTTPSErrors: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    // 1. 그룹웨어 접속
    log('Login', '그룹웨어 접속...');
    await page.goto(CONFIG.GW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // 2. Google 로그인 버튼 클릭
    log('Login', 'Google 로그인 클릭...');
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.click('#btnLoginGoogle'),
    ]);
    await popup.waitForLoadState('networkidle');

    // 3. Google 이메일 입력
    log('Login', 'Google 이메일 입력...');
    await popup.fill('input[type="email"]', `${username}@hancom.com`);
    await popup.click('button:has-text("다음"), #identifierNext');

    // 네비게이션 대기 (Okta로 리다이렉트)
    try {
      await popup.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
    } catch (e) {
      log('Login', 'navigation 대기 타임아웃, 계속 진행');
    }

    // 4. Okta ID 입력
    log('Login', 'Okta 페이지 도달, 아이디 입력...');
    await popup.waitForSelector('input[name="identifier"], input[type="text"]', { timeout: 15000 });
    await sleep(300);
    await popup.fill('input[name="identifier"], input[type="text"]', username);
    await sleep(300);
    await popup.click('input[type="submit"], button[type="submit"]');

    // 5. MFA 선택
    log('Login', 'MFA 선택 화면 대기...');
    await popup.waitForSelector('[data-se="okta_verify-push"]', { timeout: 20000 });
    await sleep(300);
    log('Login', '푸시 알림 받기 선택 클릭...');
    await popup.click('[data-se="okta_verify-push"] a');

    // 6. 푸시 보내기
    log('Login', '푸시 보내기 화면 대기...');
    await popup.waitForSelector('input[type="submit"][value="푸시 보내기"]', { timeout: 15000 });
    await sleep(300);
    log('Login', '푸시 보내기 버튼 클릭...');
    await popup.click('input[type="submit"][value="푸시 보내기"]');

    // Chat 알림
    await sendChatMessage(spaceId, '📱 Okta Verify 앱으로 푸시를 보냈습니다. 앱에서 승인해주세요.');

    // 7. MFA 승인 대기 (팝업이 닫힐 때까지 대기)
    log('Login', '--- Okta 푸시 승인 대기 중 (3분 타임아웃) ---');
    const waitForMfaApproval = async () => {
      const startTime = Date.now();
      while (Date.now() - startTime < CONFIG.MFA_WAIT_TIMEOUT) {
        // 1. 팝업이 닫혔는지 확인
        if (popup.isClosed()) {
          log('Login', '팝업이 닫혔습니다 - 인증 완료');
          return 'popup_closed';
        }

        // 2. 메인 페이지가 이미 로그인되었는지 확인 (로그인 페이지 제외)
        const currentUrl = page.url();
        if (currentUrl.includes('homGwMain') || (currentUrl.includes('ekp/') && !currentUrl.includes('login'))) {
          log('Login', '메인 페이지 로그인 확인됨:', currentUrl);
          return 'main_logged_in';
        }

        // 3. 팝업이 인증 페이지를 벗어났는지 확인
        try {
          const popupUrl = popup.url();
          if (!popupUrl.includes('okta.hancom.com') && !popupUrl.includes('accounts.google.com')) {
            log('Login', '팝업이 인증 완료 후 리다이렉트:', popupUrl);
            return 'popup_redirected';
          }
        } catch (e) {
          // 팝업 접근 불가 = 닫힌 것으로 추정
          log('Login', '팝업 상태 확인 불가 (닫힘 추정)');
          return 'popup_closed';
        }
        await sleep(2000);
      }
      return 'timeout';
    };

    const mfaResult = await waitForMfaApproval();
    log('Login', 'MFA 대기 결과:', mfaResult);

    // 8. 메인 페이지 로그인 완료 대기 (이미 로그인됐으면 스킵)
    if (mfaResult !== 'main_logged_in') {
      log('Login', '메인 페이지 로그인 완료 대기...');
      try {
        await page.waitForURL((url) => url.href.includes('homGwMain'), { timeout: 30000 });
        log('Login', '메인 페이지 URL 확인됨:', page.url());
      } catch (e) {
        log('Login', '메인 페이지 URL 대기 타임아웃, 직접 이동 시도');
        await page.goto('https://gw.hancom.com/ekp/scr/main/homGwMain', { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await sleep(2000);
      }
    } else {
      log('Login', '이미 로그인된 상태, 대기 스킵');
    }

    // 9. 쿠키 저장 (현재 페이지에서 바로)
    await sleep(1000);

    const cookies = await context.cookies();
    fs.writeFileSync(CONFIG.COOKIE_PATH, JSON.stringify(cookies, null, 2));
    log('Login', `쿠키 저장 완료: ${cookies.length}개`);

    // 10. userInfo 저장 (v3.0 API용)
    try {
      const userInfo = await page.evaluate(() => {
        if (typeof loginUserInfo !== 'undefined') {
          return {
            empId: loginUserInfo.empId,
            cmpId: loginUserInfo.cmpId,
            userId: loginUserInfo.userId,
            userName: loginUserInfo.userName,
            deptId: loginUserInfo.deptId,
            deptCd: loginUserInfo.deptCd,
            deptName: loginUserInfo.deptName,
          };
        }
        return null;
      });
      if (userInfo) {
        const userInfoPath = path.join(__dirname, 'userinfo.json');
        fs.writeFileSync(userInfoPath, JSON.stringify(userInfo, null, 2));
        log('Login', `userInfo 저장 완료: ${userInfo.userName}`);
      }
    } catch (e) {
      log('Login', `userInfo 저장 실패: ${e.message}`);
    }

    await sendChatMessage(spaceId, '✅ 로그인 완료!');

    // returnBrowser 옵션이 true이면 브라우저를 닫지 않고 반환
    if (returnBrowser) {
      return { success: true, browser, context, page };
    }

    await browser.close();
    return { success: true };

  } catch (err) {
    log('Login', '에러:', err.message);
    await sendChatMessage(spaceId, `❌ 로그인 실패: ${err.message}`);
    await browser.close();
    return { success: false, error: err.message };
  }
}

// ========== 스크래핑 ==========
async function getLoginUserInfo(page) {
  try {
    // 메인 페이지 접속 (loginUserInfo 변수 로드를 위해)
    log('Scrape', '그룹웨어 메인 페이지 접속...');
    await page.goto(CONFIG.GW_URL, { waitUntil: 'load', timeout: 30000 });
    await sleep(1000);

    // 디버깅: 현재 URL 확인
    const currentUrl = page.url();
    const pageTitle = await page.title();
    log('Scrape', `현재 URL: ${currentUrl}`);
    log('Scrape', `페이지 제목: ${pageTitle}`);

    // 로그인 페이지로 리다이렉트되었는지 확인
    if (currentUrl.includes('login') || currentUrl.includes('okta')) {
      log('Scrape', '경고: 로그인 페이지로 리다이렉트됨 - 세션 만료');
      await page.screenshot({ path: 'debug-login-redirect.png' });
      return null;
    }

    // 페이지의 전역 변수에서 사용자 정보 추출
    const userInfo = await page.evaluate(() => {
      if (typeof loginUserInfo !== 'undefined') {
        return {
          empId: loginUserInfo.empId,
          cmpId: loginUserInfo.cmpId,
          userId: loginUserInfo.userId,
          userName: loginUserInfo.userName,
          deptId: loginUserInfo.deptId,
          deptCd: loginUserInfo.deptCd,
          deptName: loginUserInfo.deptName,
        };
      }
      return null;
    });

    if (!userInfo) {
      log('Scrape', 'loginUserInfo를 찾을 수 없습니다');
      await page.screenshot({ path: 'debug-no-userinfo.png' });
      return null;
    }

    log('Scrape', `사용자: ${userInfo.userName} (${userInfo.empId})`);
    return userInfo;
  } catch (e) {
    log('Scrape', '에러:', e.message);
    return null;
  }
}

// ========== 스크래핑 함수 (Worker 프로젝트 기준) ==========

async function scrapeTeamAttendance(page, userInfo) {
  log('Scrape', '[팀 현황] API 호출 시작');

  const response = await page.request.post(CONFIG.API.EMP_LIST, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'naonajax': 'json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    form: {
      orderMode: 'RANK_USERNAME',
      listType: 'list',
      'paging.pageNo': '1',
      'paging.listBlock': '50',
      deptId: userInfo.deptId,
      cmpId: userInfo.cmpId,
      subDeptYn: 'N',
      serviceType: 'org',
      afflMode: '',
      searchWord: '',
      typeSearch: '',
    },
  });

  if (!response.ok()) {
    throw new Error(`API 응답 에러: ${response.status()}`);
  }

  const json = await response.json();
  const empList = json.data?.empList || json.empList || json.list || [];
  log('Scrape', `[팀 현황] 팀원 수: ${empList.length}`);

  const attendance = { working: [], offWork: [], leave: [], outside: [], halfDay: [], health: [] };

  // 상태 분류 헬퍼
  function categorizeStatus(atnStatus) {
    if (!atnStatus) return 'working';
    for (const [category, keywords] of Object.entries(ATN_STATUS)) {
      if (keywords.some(kw => atnStatus.includes(kw))) {
        return category;
      }
    }
    return 'working';
  }

  empList.forEach((emp) => {
    const atnStatus = emp.empAtnStatus || '';
    const member = {
      name: emp.personBean?.userName || emp.userName || '이름없음',
      status: atnStatus,
    };

    const category = categorizeStatus(atnStatus);
    log('Scrape', `[팀원] ${member.name}: "${atnStatus}" → ${category}`);
    if (attendance[category]) {
      attendance[category].push(member);
    }
  });

  log('Scrape', `[팀 현황] 출근: ${attendance.working.length}명, 퇴근: ${attendance.offWork.length}명, 휴가: ${attendance.leave.length}명`);
  return { totalMembers: empList.length, attendance };
}

async function scrapeLeaveBalance(page, userInfo) {
  try {
    log('Scrape', '[연차] HTML 파싱 방식 시작');

    // 1. 근태관리 페이지 이동
    log('Scrape', '[연차] 1. 근태관리 페이지 이동');
    await page.goto('https://gw.hancom.com/ekp/scr/attend/atnAttendMain', {
      waitUntil: 'load',
      timeout: 30000,
    });
    await sleep(2000);

    // 2. "연차 사용 내역" 메뉴 클릭
    log('Scrape', '[연차] 2. 연차 사용 내역 메뉴 클릭');
    await page.click('a.item:has-text("연차 사용 내역")');
    await sleep(3000);

    // 3. 상단 요약 정보에서 연차 데이터 추출
    log('Scrape', '[연차] 3. HTML에서 연차 정보 추출');
    const leaveData = await page.evaluate(() => {
      const result = {
        total: 0,
        used: 0,
        remaining: 0,
        specialRemaining: 0,
        rewardRemaining: 0,
        prizeRemaining: 0,
      };

      // 상단 요약 박스에서 값 추출 (count_box 구조)
      const countBoxes = document.querySelectorAll('.count_box, .leave_count .count_box');
      countBoxes.forEach(box => {
        const text = box.textContent?.trim() || '';
        const numMatch = text.match(/(\d+\.?\d*)/);
        const num = numMatch ? parseFloat(numMatch[1]) : 0;

        if (text.includes('총 연차') || text.includes('총연차')) {
          result.total = num;
        } else if (text.includes('사용 연차') || text.includes('사용연차')) {
          result.used = num;
        } else if (text.includes('잔여 연차') || text.includes('잔여연차')) {
          result.remaining = num;
        } else if (text.includes('잔여 포상') || text.includes('포상휴가')) {
          result.prizeRemaining = num;
        } else if (text.includes('잔여 보상') || text.includes('보상휴가')) {
          result.rewardRemaining = num;
        } else if (text.includes('잔여 특별') || text.includes('특별휴가')) {
          result.specialRemaining = num;
        }
      });

      // 테이블 마지막 행에서도 확인 (백업)
      const table = document.querySelector('table');
      if (table) {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 1) {
          const lastRow = rows[rows.length - 1];
          const cells = lastRow.querySelectorAll('td');
          // 테이블 헤더: 날짜, 내역, 사용연차, 잔여연차, 사용특별, 잔여특별, 사용보상, 잔여보상, 사용포상, 잔여포상
          if (cells.length >= 10) {
            if (result.remaining === 0) result.remaining = parseFloat(cells[3]?.textContent) || 0;
            if (result.specialRemaining === 0) result.specialRemaining = parseFloat(cells[5]?.textContent) || 0;
            if (result.rewardRemaining === 0) result.rewardRemaining = parseFloat(cells[7]?.textContent) || 0;
            if (result.prizeRemaining === 0) result.prizeRemaining = parseFloat(cells[9]?.textContent) || 0;
          }
        }
      }

      return result;
    });

    log('Scrape', `[연차] 추출 결과: 총=${leaveData.total}, 사용=${leaveData.used}, 잔여=${leaveData.remaining}, 포상=${leaveData.prizeRemaining}, 보상=${leaveData.rewardRemaining}`);

    return leaveData;
  } catch (e) {
    log('Scrape', `[연차] 에러: ${e.message}`);
    return { total: 0, used: 0, remaining: 0, specialRemaining: 0, rewardRemaining: 0, prizeRemaining: 0 };
  }
}

async function scrapeApproval(page, userInfo) {
  log('Scrape', '[결재] API 호출 시작');

  // 방법 1: 전자결재 페이지에서 미결함 건수 확인
  log('Scrape', '[결재] 방법1: 미결함 API 호출');
  try {
    const response1 = await page.request.post(
      'https://gw.hancom.com/ekp/service/eapp/selectAppList',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Naonajax': 'json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        data: `__REQ_JSON_OBJECT__${JSON.stringify({
          appType: 'TODO',  // 미결함
          pageNo: 1,
          listCnt: 50,
        })}`,
      }
    );

    const text1 = await response1.text();
    log('Scrape', `[결재] 방법1 응답 (${response1.status()}): ${text1.substring(0, 500)}`);

    if (response1.ok() && text1) {
      const json1 = JSON.parse(text1);
      const list = json1.data?.list || json1.list || [];
      const totalCount = json1.data?.paging?.totalCount || json1.data?.totalCount || list.length;
      log('Scrape', `[결재] 방법1 성공: ${totalCount}건 대기`);
      return { pending: totalCount, list };
    }
  } catch (e1) {
    log('Scrape', `[결재] 방법1 실패: ${e1.message}`);
  }

  // 방법 2: eapp/app.do 페이지 기반
  log('Scrape', '[결재] 방법2: eapp/app.do 호출');
  try {
    const response2 = await page.request.post(
      'https://gw.hancom.com/ekp/eapp/app.do',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        data: 'cmd=appList&appType=TODO&pageNo=1&listCnt=50',
      }
    );

    const text2 = await response2.text();
    log('Scrape', `[결재] 방법2 응답 (${response2.status()}): ${text2.substring(0, 500)}`);

    if (response2.ok() && text2) {
      try {
        const json2 = JSON.parse(text2);
        const list = json2.data?.list || json2.list || [];
        const totalCount = json2.data?.paging?.totalCount || json2.data?.totalCount || list.length;
        log('Scrape', `[결재] 방법2 성공: ${totalCount}건 대기`);
        return { pending: totalCount, list };
      } catch (parseErr) {
        // HTML 응답일 수 있음 - 테이블에서 건수 추출 시도
        const countMatch = text2.match(/총\s*(\d+)\s*건/);
        if (countMatch) {
          log('Scrape', `[결재] 방법2 HTML 파싱: ${countMatch[1]}건`);
          return { pending: parseInt(countMatch[1], 10) };
        }
      }
    }
  } catch (e2) {
    log('Scrape', `[결재] 방법2 실패: ${e2.message}`);
  }

  // 방법 3: RSS API (기존 방식)
  log('Scrape', '[결재] 방법3: RSS API (eappTodoList)');
  try {
    const response3 = await page.request.get(CONFIG.API.APPROVAL, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const text3 = await response3.text();
    log('Scrape', `[결재] 방법3 응답 (${response3.status()}): ${text3.substring(0, 500)}`);

    if (response3.ok() && text3) {
      // JSON 시도
      try {
        const json3 = JSON.parse(text3);
        const list = json3.data?.list || json3.list || json3.items || json3.item || [];
        const pending = Array.isArray(list) ? list.length : 0;
        log('Scrape', `[결재] 방법3 JSON: ${pending}건`);
        return { pending };
      } catch (e) {
        // XML/RSS 파싱
        const itemMatches = text3.match(/<item>/gi);
        const pending = itemMatches ? itemMatches.length : 0;
        log('Scrape', `[결재] 방법3 XML: ${pending}건`);
        return { pending };
      }
    }
  } catch (e3) {
    log('Scrape', `[결재] 방법3 실패: ${e3.message}`);
  }

  // 모든 방법 실패
  log('Scrape', '[결재] 모든 방법 실패, 0 반환');
  return { pending: 0 };
}

async function scrapeBoard(page) {
  try {
    log('Scrape', '[게시판] HTML 파싱 방식 시작');

    // 1. 게시판 페이지 직접 이동
    log('Scrape', '[게시판] 게시판 페이지 직접 이동');
    await page.goto('https://gw.hancom.com/ekp/main/home/homGwMainSub?at=TU5VMjc3NjAyMDAwMTk5NzgxOTI1Nzk%3D', { waitUntil: 'load', timeout: 30000 });
    await sleep(2000);

    // 2. 게시판 프레임 찾기
    const frames = page.frames();
    let boardFrame = null;
    for (const frame of frames) {
      if (frame.url().includes('boardMain')) {
        boardFrame = frame;
        break;
      }
    }
    const targetFrame = boardFrame || page;

    // 4. 오늘/어제 날짜
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const formatDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const todayStr = formatDate(today);
    const yesterdayStr = formatDate(yesterday);

    // 5. 최근 게시글 추출 (어제/오늘)
    log('Scrape', '[게시판] 최근 게시글 추출');
    const posts = await targetFrame.evaluate((dates) => {
      const { todayStr, yesterdayStr } = dates;
      const result = [];

      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 7) {
          // cell4: 제목 및 링크 정보
          const titleCell = cells[4];
          let title = titleCell?.textContent?.trim().replace(/\s+/g, ' ') || '';
          title = title.replace(/새창으로 보기/g, '').replace(/\d+$/g, '').trim();

          // 게시글 ID 추출
          const atclLink = titleCell?.querySelector('a[data-atcl-id]');
          const atclId = atclLink?.getAttribute('data-atcl-id') || '';

          // cell6: 날짜
          const dateText = cells[6]?.textContent?.trim() || '';

          if (title && dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
            if (dateText === todayStr || dateText === yesterdayStr) {
              let link = '';
              if (atclId) {
                link = `https://gw.hancom.com/ekp/view/board/article/brdAtclViewPopup?atclId=${atclId}&access=`;
              }
              result.push({ title: title.substring(0, 40), date: dateText, link });
            }
          }
        }
      }
      return result;
    }, { todayStr, yesterdayStr });

    log('Scrape', `[게시판] 최근 게시글: ${posts.length}건`);
    return { unreadCount: posts.length, recentPosts: posts };
  } catch (e) {
    log('Scrape', `[게시판] 에러: ${e.message}`);
    return { unreadCount: 0, recentPosts: [] };
  }
}

async function scrapeNote(page) {
  log('Scrape', '[쪽지] API 호출 시작');

  const response = await page.request.post(CONFIG.API.NOTE, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      'Naonajax': 'json',
    },
    data: {
      noteType: '2',
      param: {
        boxType: 'RECV_NOTE_NOTIC_LIST',
        readYn: 'N',
        listCnt: 50,
        pageNo: 0,
        incPrevNext: true,
      },
    },
  });

  if (!response.ok()) {
    throw new Error(`쪽지 API 응답 에러: ${response.status()}`);
  }

  const result = await response.json();
  const totalCount = result.data?.paging?.totalCount || 0;

  log('Scrape', `[쪽지] 안 읽은 쪽지: ${totalCount}건`);
  return { unreadCount: totalCount };
}

async function scrapeMail(page) {
  log('Scrape', '[메일] API 호출 시작');

  const response = await page.request.post(CONFIG.API.MAIL, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Naonajax': 'xml',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!response.ok()) {
    throw new Error(`메일 API 응답 에러: ${response.status()}`);
  }

  const xmlText = await response.text();
  const countMatch = xmlText.match(/<description><!\[CDATA\[(\d+)\]\]><\/description>/);
  const unreadCount = countMatch ? parseInt(countMatch[1], 10) : 0;

  log('Scrape', `[메일] 안 읽은 메일: ${unreadCount}건`);
  return { unreadCount };
}

async function scrapeBudget(page, userInfo) {
  try {
    log('Scrape', '[예실] HTML 파싱 방식 시작');

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // 분기 계산
    let quarter, startMonth, endMonth;
    if (month <= 3) {
      quarter = 1; startMonth = '01'; endMonth = '03';
    } else if (month <= 6) {
      quarter = 2; startMonth = '04'; endMonth = '06';
    } else if (month <= 9) {
      quarter = 3; startMonth = '07'; endMonth = '09';
    } else {
      quarter = 4; startMonth = '10'; endMonth = '12';
    }

    log('Scrape', `[예실] ${quarter}분기 조회: ${year}년 ${startMonth}~${endMonth}월`);

    // 1. 업무지원 페이지 직접 이동
    log('Scrape', '[예실] 1. 업무지원 페이지 직접 이동');
    await page.goto('https://gw.hancom.com/ekp/main/home/homGwMainSub?at=TU5VMjc3NjM0ODQyMDg4OTA5MzIzNzY%3D', { waitUntil: 'load', timeout: 30000 });
    log('Scrape', '[예실] 메뉴 로딩 대기...');
    await sleep(3500);

    // 2. 메뉴 프레임에서 예실현황 클릭
    log('Scrape', '[예실] 2. 메뉴 프레임 찾기');
    const frames = page.frames();
    let menuFrame = null;
    for (const frame of frames) {
      if (frame.url().includes('mnuMenuPageMain')) {
        menuFrame = frame;
        break;
      }
    }
    if (!menuFrame) {
      log('Scrape', '[예실] 메뉴 프레임을 찾을 수 없음');
      return null;
    }

    // 3. 예실현황 클릭
    log('Scrape', '[예실] 3. 예실현황 클릭');
    await menuFrame.click('text=예실현황');
    await sleep(2000);

    // 5. 예산 콘텐츠 프레임 찾기
    const frames2 = page.frames();
    let budgetFrame = null;
    for (const frame of frames2) {
      const url = frame.url();
      if (url.includes('budget') || url.includes('Budget')) {
        budgetFrame = frame;
      }
    }
    const targetFrame = budgetFrame || page;

    // 6. 날짜 범위 설정 (분기별) - change 이벤트로 자동 조회 트리거
    log('Scrape', '[예실] 4. 날짜 범위 설정');
    try {
      await targetFrame.evaluate((opts) => {
        const { startMonth, endMonth } = opts;
        // 시작월 설정
        const startSel = document.querySelector('select[id*="startMonth"]');
        if (startSel) {
          startSel.value = startMonth;
          startSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // 종료월 설정
        const endSel = document.querySelector('select[id*="endMonth"]');
        if (endSel) {
          endSel.value = endMonth;
          endSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { startMonth, endMonth });
    } catch (e) {
      log('Scrape', `[예실] 날짜 설정 실패: ${e.message}`);
    }

    // 데이터 로드 대기 (분기 변경 후 조회 완료까지)
    log('Scrape', '[예실] 데이터 로드 대기...');
    await sleep(2500);

    // 7. 테이블 데이터 추출
    log('Scrape', '[예실] 5. 테이블 데이터 추출');
    const budgetData = await targetFrame.evaluate(() => {
      const result = {
        items: [],
        total: { budget: 0, spent: 0, remaining: 0 }
      };

      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const text = row.textContent || '';
            const textNormalized = text.replace(/\s+/g, '');

            // 총 합계 행 ("총 합 계" 또는 "총합계")
            if (textNormalized.includes('총합계') || textNormalized.includes('합계')) {
              const nums = [];
              cells.forEach(cell => {
                const val = cell.textContent?.trim().replace(/,/g, '');
                if (/^\d+$/.test(val)) {
                  nums.push(parseInt(val, 10));
                }
              });
              if (nums.length >= 3) {
                result.total = {
                  budget: nums[0] || 0,
                  spent: nums[1] || 0,
                  remaining: nums[2] || 0
                };
              }
            }
            // 항목별 행
            else if (cells.length >= 5) {
              const account = cells[1]?.textContent?.trim() || '';
              if (account && !account.includes('계정') && account.length > 0) {
                const budgetVal = cells[2]?.textContent?.trim().replace(/,/g, '') || '0';
                const spentVal = cells[3]?.textContent?.trim().replace(/,/g, '') || '0';
                const remainVal = cells[4]?.textContent?.trim().replace(/,/g, '') || '0';

                if (/^\d+$/.test(budgetVal) || /^\d+$/.test(spentVal)) {
                  result.items.push({
                    account,
                    budget: parseInt(budgetVal, 10) || 0,
                    spent: parseInt(spentVal, 10) || 0,
                    remaining: parseInt(remainVal, 10) || 0
                  });
                }
              }
            }
          }
        }
      }

      return result;
    });

    const formatAmount = (num) => num.toLocaleString('ko-KR');

    log('Scrape', `[예실] 총 예산: ${budgetData.total.budget}, 사용: ${budgetData.total.spent}, 잔액: ${budgetData.total.remaining}`);
    log('Scrape', `[예실] 항목 수: ${budgetData.items.length}`);

    return {
      year,
      quarter,
      period: `${year}년 ${quarter}분기`,
      budget: formatAmount(budgetData.total.budget),
      spent: formatAmount(budgetData.total.spent),
      remaining: formatAmount(budgetData.total.remaining),
      budgetNum: budgetData.total.budget,
      spentNum: budgetData.total.spent,
      remainingNum: budgetData.total.remaining,
      items: budgetData.items.map(item => ({
        account: item.account,
        budget: formatAmount(item.budget),
        spent: formatAmount(item.spent),
        remaining: formatAmount(item.remaining)
      }))
    };
  } catch (e) {
    log('Scrape', `[예실] 에러: ${e.message}`);
    return null;
  }
}

async function doScrape(task, existingSession = null) {
  const { spaceId } = task;
  log('Scrape', '시작');

  let browser = null;
  let page = null;
  let shouldCloseBrowser = false;

  // 기존 세션이 있으면 사용, 없으면 쿠키에서 새 브라우저 생성
  if (existingSession) {
    log('Scrape', '기존 로그인 세션 사용');
    browser = existingSession.browser;
    page = existingSession.page;
    shouldCloseBrowser = false;  // 호출자가 닫음
  } else {
    log('Scrape', '쿠키에서 새 브라우저 생성');
    if (!fs.existsSync(CONFIG.COOKIE_PATH)) {
      await sendChatMessage(spaceId, '❌ 쿠키가 없습니다. 먼저 로그인해주세요.');
      return { success: false, error: 'No cookies' };
    }

    const cookies = JSON.parse(fs.readFileSync(CONFIG.COOKIE_PATH, 'utf-8'));
    log('Scrape', `쿠키 로드: ${cookies.length}개`);

    browser = await chromium.launch({
      headless: false,  // 디버깅용
      ignoreHTTPSErrors: true,
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    await context.addCookies(cookies);
    page = await context.newPage();
    shouldCloseBrowser = true;  // 이 함수에서 닫음
  }

  try {
    let userInfo;

    if (existingSession) {
      // 기존 세션: 이미 로그인된 상태이므로 현재 페이지에서 바로 userInfo 추출
      log('Scrape', '현재 페이지에서 userInfo 추출...');
      await sleep(1000);
      userInfo = await page.evaluate(() => {
        if (typeof loginUserInfo !== 'undefined') {
          return {
            empId: loginUserInfo.empId,
            cmpId: loginUserInfo.cmpId,
            userId: loginUserInfo.userId,
            userName: loginUserInfo.userName,
            deptId: loginUserInfo.deptId,
            deptCd: loginUserInfo.deptCd,
            deptName: loginUserInfo.deptName,
          };
        }
        return null;
      });

      if (!userInfo) {
        log('Scrape', 'userInfo 없음, 메인 페이지로 이동 시도...');
        await page.goto('https://gw.hancom.com/ekp/scr/main/homGwMain', { waitUntil: 'load', timeout: 30000 });
        await sleep(1000);
        userInfo = await page.evaluate(() => {
          if (typeof loginUserInfo !== 'undefined') {
            return {
              empId: loginUserInfo.empId,
              cmpId: loginUserInfo.cmpId,
              userId: loginUserInfo.userId,
              userName: loginUserInfo.userName,
              deptId: loginUserInfo.deptId,
              deptCd: loginUserInfo.deptCd,
              deptName: loginUserInfo.deptName,
            };
          }
          return null;
        });
      }
    } else {
      // 쿠키 기반: 기존 getLoginUserInfo 사용
      userInfo = await getLoginUserInfo(page);
    }

    if (!userInfo) throw new Error('로그인 만료됨 - 다시 로그인해주세요');

    log('Scrape', `사용자: ${userInfo.userName}`);

    log('Scrape', `userInfo: ${JSON.stringify(userInfo)}`);

    // scrapeType에 따라 필요한 것만 스크래핑
    const scrapeType = task.scrapeType || 'all';
    log('Scrape', `scrapeType: ${scrapeType}`);

    let team = null, leave = null, approval = null, board = null, note = null, mail = null, budget = null;

    if (scrapeType === 'all') {
      await sendChatMessage(spaceId, '⏳ 데이터 수집 중...');

      // API 방식은 병렬 실행 (HTTP 요청만 하므로 충돌 없음)
      [team, approval, note, mail] = await Promise.all([
        scrapeTeamAttendance(page, userInfo).catch(e => { log('Scrape', `팀 현황 에러: ${e.message}`); return null; }),
        scrapeApproval(page, userInfo).catch(e => { log('Scrape', `결재 에러: ${e.message}`); return null; }),
        scrapeNote(page).catch(e => { log('Scrape', `쪽지 에러: ${e.message}`); return null; }),
        scrapeMail(page).catch(e => { log('Scrape', `메일 에러: ${e.message}`); return null; }),
      ]);

      // HTML 파싱 방식은 순차 실행 (페이지 네비게이션 충돌 방지)
      leave = await scrapeLeaveBalance(page, userInfo).catch(e => { log('Scrape', `연차 에러: ${e.message}`); return null; });
      board = await scrapeBoard(page).catch(e => { log('Scrape', `게시판 에러: ${e.message}`); return null; });
      budget = await scrapeBudget(page, userInfo).catch(e => { log('Scrape', `예실 에러: ${e.message}`); return null; });
    } else {
      // 개별 스크래핑
      switch (scrapeType) {
        case 'team':
          team = await scrapeTeamAttendance(page, userInfo).catch(e => { log('Scrape', `팀 현황 에러: ${e.message}`); return null; });
          break;
        case 'leave':
          log('Scrape', '>>> leave 케이스 진입');
          leave = await scrapeLeaveBalance(page, userInfo).catch(e => { log('Scrape', `연차 에러: ${e.message}`); return null; });
          log('Scrape', '>>> leave 완료');
          break;
        case 'approval':
          approval = await scrapeApproval(page, userInfo).catch(e => { log('Scrape', `결재 에러: ${e.message}`); return null; });
          break;
        case 'board':
          board = await scrapeBoard(page).catch(e => { log('Scrape', `게시판 에러: ${e.message}`); return null; });
          break;
        case 'note':
          note = await scrapeNote(page).catch(e => { log('Scrape', `쪽지 에러: ${e.message}`); return null; });
          break;
        case 'mail':
          mail = await scrapeMail(page).catch(e => { log('Scrape', `메일 에러: ${e.message}`); return null; });
          break;
        case 'budget':
          budget = await scrapeBudget(page, userInfo).catch(e => { log('Scrape', `예실 에러: ${e.message}`); return null; });
          break;
      }
    }

    log('Scrape', `결과 - team: ${JSON.stringify(team)}, leave: ${JSON.stringify(leave)}, budget: ${JSON.stringify(budget)}`);

    // 메시지 포맷팅
    const lines = [];
    const timestamp = new Date().toLocaleString('ko-KR');

    if (scrapeType === 'all') {
      lines.push(`📊 *그룹웨어 현황* (${timestamp})`);
      lines.push('');
    }

    if (team) {
      if (scrapeType !== 'all') lines.push(`👥 *팀 현황* (${timestamp})`);
      else lines.push(`👥 *팀 현황* (${team.totalMembers}명)`);

      // 요약 라인 (0명인 항목은 제외)
      const summary = [];
      if (team.attendance.leave.length > 0) summary.push(`휴가: ${team.attendance.leave.length}명`);
      if (team.attendance.outside.length > 0) summary.push(`외근: ${team.attendance.outside.length}명`);
      if (team.attendance.halfDay.length > 0) summary.push(`반차: ${team.attendance.halfDay.length}명`);
      if (team.attendance.health?.length > 0) summary.push(`건강검진: ${team.attendance.health.length}명`);
      if (summary.length > 0) {
        lines.push(`   ${summary.join(', ')}`);
      }

      if (team.attendance.leave.length > 0) {
        lines.push(`   🏖️ ${team.attendance.leave.map(m => m.name).join(', ')}`);
      }
      if (team.attendance.health?.length > 0) {
        lines.push(`   🏥 ${team.attendance.health.map(m => m.name).join(', ')}`);
      }
      if (team.attendance.working && team.attendance.working.length > 0) {
        lines.push(`   ✅ 출근: ${team.attendance.working.map(m => m.name).join(', ')}`);
      }
      if (team.attendance.offWork && team.attendance.offWork.length > 0) {
        lines.push(`   🚪 퇴근: ${team.attendance.offWork.map(m => m.name).join(', ')}`);
      }
      if (scrapeType === 'all') lines.push('');
    }

    if (leave) {
      if (scrapeType !== 'all') lines.push(`🏖️ *내 연차* (${timestamp})`);
      lines.push(`🏖️ 연차 ${leave.remaining}일 남음 (${leave.used}/${leave.total}일 사용)`);
      // 기타 휴가 표시 (잔여가 있는 경우만)
      const otherLeaves = [];
      if (leave.prizeRemaining > 0) otherLeaves.push(`포상 ${leave.prizeRemaining}일`);
      if (leave.rewardRemaining > 0) otherLeaves.push(`보상 ${leave.rewardRemaining}일`);
      if (leave.specialRemaining > 0) otherLeaves.push(`특별 ${leave.specialRemaining}일`);
      if (otherLeaves.length > 0) {
        lines.push(`   + ${otherLeaves.join(', ')}`);
      }
      if (scrapeType === 'all') lines.push('');
    }

    if (approval) {
      if (scrapeType !== 'all') lines.push(`📝 *전자결재* (${timestamp})`);
      lines.push(`📝 ${approval.pending}건 대기`);
    }

    if (board) {
      if (scrapeType !== 'all') lines.push(`📌 *새 게시글* (${timestamp})`);
      if (board.recentPosts && board.recentPosts.length > 0) {
        lines.push(`📌 새 게시글 ${board.recentPosts.length}건`);
        board.recentPosts.slice(0, 5).forEach(post => {
          if (post.link) {
            lines.push(`   • <${post.link}|${post.title}>`);
          } else {
            lines.push(`   • ${post.title}`);
          }
        });
        if (board.recentPosts.length > 5) {
          lines.push(`   ... 외 ${board.recentPosts.length - 5}건`);
        }
      } else {
        lines.push(`📌 새 게시글 없음`);
      }
    }

    if (note) {
      if (scrapeType !== 'all') lines.push(`✉️ *쪽지* (${timestamp})`);
      lines.push(`✉️ ${note.unreadCount}건 안 읽음`);
    }

    if (mail) {
      if (scrapeType !== 'all') lines.push(`📧 *메일* (${timestamp})`);
      lines.push(`📧 ${mail.unreadCount}건 안 읽음`);
    }

    if (budget) {
      if (scrapeType !== 'all') lines.push(`💰 *예실현황* (${timestamp})`);
      lines.push(`💰 ${budget.period}`);
      lines.push(`   총 예산: ${budget.budget}원 / 사용: ${budget.spent}원 / 잔액: ${budget.remaining}원`);
      if (budget.items && budget.items.length > 0) {
        lines.push(`   ─────────`);
        budget.items.forEach(item => {
          const usedPct = budget.budgetNum > 0 ? Math.round((parseInt(item.spent.replace(/,/g, '')) / parseInt(item.budget.replace(/,/g, ''))) * 100) || 0 : 0;
          lines.push(`   • ${item.account}: ${item.budget}원 (사용 ${usedPct}%)`);
        });
      }
    }

    const resultMessage = lines.join('\n');
    log('Scrape', '결과:\n' + resultMessage);
    await sendChatMessage(spaceId, resultMessage);
    log('Scrape', '완료');
    return { success: true };

  } catch (err) {
    log('Scrape', '에러:', err.message);
    await sendChatMessage(spaceId, `❌ 스크래핑 실패: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (shouldCloseBrowser && browser) {
      await browser.close();
    }
  }
}

// ========== v3.0: API 직접 호출 스크래핑 ==========
// API로 가능한 것: team, approval, note, mail
// Playwright 필요한 것: leave, board, budget (페이지 시퀀스 필요)
const API_SUPPORTED = ['team', 'approval', 'note', 'mail'];

async function doScrapeV3(task) {
  const { spaceId, scrapeType = 'all' } = task;
  log('ScrapeV3', `시작 (${scrapeType})`);

  // Playwright가 필요한 타입은 v2 방식으로 처리
  if (['leave', 'board', 'budget', 'all'].includes(scrapeType)) {
    log('ScrapeV3', `${scrapeType}은 Playwright 필요, v2 방식으로 전환`);
    return { success: false, error: 'needs_playwright', usePlaywright: true };
  }

  try {
    // 쿠키 파일 확인
    if (!fs.existsSync(CONFIG.COOKIE_PATH)) {
      return { success: false, error: 'No cookies', needLogin: true };
    }

    // API 클라이언트 초기화
    const client = new GwApiClient();
    await client.init();
    log('ScrapeV3', `사용자: ${client.userInfo.userName}`);

    let result = {};

    // API로 가능한 것만 처리 (team, approval, note, mail)
    switch (scrapeType) {
      case 'team':
        result.team = await client.getTeamAttendance();
        break;
      case 'approval':
        result.approval = await client.getApproval();
        break;
      case 'note':
        result.note = await client.getNote();
        break;
      case 'mail':
        result.mail = await client.getMail();
        break;
    }

    // 메시지 포맷팅
    const lines = [];
    const timestamp = new Date().toLocaleString('ko-KR');
    const { team, leave, approval, board, note, mail, budget } = result;

    if (scrapeType === 'all') {
      lines.push(`📊 *그룹웨어 현황* (${timestamp})`);
      lines.push('');
    }

    if (team) {
      if (scrapeType !== 'all') lines.push(`👥 *팀 현황* (${timestamp})`);
      else lines.push(`👥 *팀 현황* (${team.totalMembers}명)`);

      const summary = [];
      if (team.attendance.leave.length > 0) summary.push(`휴가: ${team.attendance.leave.length}명`);
      if (team.attendance.outside.length > 0) summary.push(`외근: ${team.attendance.outside.length}명`);
      if (team.attendance.halfDay.length > 0) summary.push(`반차: ${team.attendance.halfDay.length}명`);
      if (team.attendance.health?.length > 0) summary.push(`건강검진: ${team.attendance.health.length}명`);
      if (summary.length > 0) lines.push(`   ${summary.join(', ')}`);

      if (team.attendance.leave.length > 0) {
        lines.push(`   🏖️ ${team.attendance.leave.map(m => m.name).join(', ')}`);
      }
      if (team.attendance.health?.length > 0) {
        lines.push(`   🏥 ${team.attendance.health.map(m => m.name).join(', ')}`);
      }
      if (team.attendance.working?.length > 0) {
        lines.push(`   ✅ 출근: ${team.attendance.working.map(m => m.name).join(', ')}`);
      }
      if (team.attendance.offWork?.length > 0) {
        lines.push(`   🚪 퇴근: ${team.attendance.offWork.map(m => m.name).join(', ')}`);
      }
      if (scrapeType === 'all') lines.push('');
    }

    if (leave) {
      if (scrapeType !== 'all') lines.push(`🏖️ *내 연차* (${timestamp})`);
      lines.push(`🏖️ 연차 ${leave.remaining}일 남음 (${leave.used}/${leave.total}일 사용)`);
      const otherLeaves = [];
      if (leave.prizeRemaining > 0) otherLeaves.push(`포상 ${leave.prizeRemaining}일`);
      if (leave.rewardRemaining > 0) otherLeaves.push(`보상 ${leave.rewardRemaining}일`);
      if (leave.specialRemaining > 0) otherLeaves.push(`특별 ${leave.specialRemaining}일`);
      if (otherLeaves.length > 0) lines.push(`   + ${otherLeaves.join(', ')}`);
      if (scrapeType === 'all') lines.push('');
    }

    if (approval) {
      if (scrapeType !== 'all') lines.push(`📝 *전자결재* (${timestamp})`);
      lines.push(`📝 ${approval.pending}건 대기`);
    }

    if (board) {
      if (scrapeType !== 'all') lines.push(`📌 *새 게시글* (${timestamp})`);
      if (board.recentPosts?.length > 0) {
        lines.push(`📌 새 게시글 ${board.recentPosts.length}건`);
        board.recentPosts.slice(0, 5).forEach(post => {
          if (post.link) {
            lines.push(`   • <${post.link}|${post.title}>`);
          } else {
            lines.push(`   • ${post.title}`);
          }
        });
        if (board.recentPosts.length > 5) {
          lines.push(`   ... 외 ${board.recentPosts.length - 5}건`);
        }
      } else {
        lines.push(`📌 새 게시글 없음`);
      }
    }

    if (note) {
      if (scrapeType !== 'all') lines.push(`✉️ *쪽지* (${timestamp})`);
      lines.push(`✉️ ${note.unreadCount}건 안 읽음`);
    }

    if (mail) {
      if (scrapeType !== 'all') lines.push(`📧 *메일* (${timestamp})`);
      lines.push(`📧 ${mail.unreadCount}건 안 읽음`);
    }

    if (budget) {
      if (scrapeType !== 'all') lines.push(`💰 *예실현황* (${timestamp})`);
      lines.push(`💰 ${budget.period}`);
      lines.push(`   총 예산: ${budget.budget}원 / 사용: ${budget.spent}원 / 잔액: ${budget.remaining}원`);
      if (budget.items?.length > 0) {
        lines.push(`   ─────────`);
        budget.items.forEach(item => {
          const budgetVal = parseInt(item.budget.replace(/,/g, '')) || 1;
          const spentVal = parseInt(item.spent.replace(/,/g, '')) || 0;
          const usedPct = Math.round((spentVal / budgetVal) * 100) || 0;
          lines.push(`   • ${item.account}: ${item.budget}원 (사용 ${usedPct}%)`);
        });
      }
    }

    const resultMessage = lines.join('\n');
    log('ScrapeV3', '결과:\n' + resultMessage);
    await sendChatMessage(spaceId, resultMessage);
    log('ScrapeV3', '완료');
    return { success: true };

  } catch (err) {
    log('ScrapeV3', '에러:', err.message);

    // 세션 만료 판단
    if (err.message.includes('세션 만료') || err.message.includes('다시 로그인')) {
      return { success: false, error: err.message, needLogin: true };
    }

    return { success: false, error: err.message };
  }
}

// ========== 메시지 핸들러 ==========
async function handleMessage(message) {
  const data = JSON.parse(message.data.toString());
  log('Worker', '메시지 수신:', data.action);
  log('Worker', '메시지 데이터:', JSON.stringify(data));

  switch (data.action) {
    case 'login':
      await doLogin(data);
      break;

    case 'scrape':
      // v3.0: API 직접 호출 방식 (브라우저 없이)
      log('Worker', 'v3.0 API 스크래핑 시도');
      const scrapeResultV3 = await doScrapeV3(data);

      // Playwright 필요한 경우 (leave, board, budget)
      if (scrapeResultV3.usePlaywright) {
        log('Worker', 'Playwright 방식으로 전환');
        const playwrightResult = await doScrape(data, null);
        if (!playwrightResult.success && playwrightResult.error?.includes('만료')) {
          log('Worker', '세션 만료, 재로그인 시도');
          const loginResult = await doLogin(data, { returnBrowser: true });
          if (loginResult.success) {
            await doScrape(data, loginResult);
            await loginResult.browser.close();
          }
        }
        break;
      }

      // 로그인 필요 시 재로그인 후 재시도
      if (!scrapeResultV3.success && scrapeResultV3.needLogin) {
        log('Worker', '세션 만료, 재로그인 시도');
        await sendChatMessage(data.spaceId, '🔄 세션 만료됨. 재로그인 중...');
        const loginResult = await doLogin(data, { returnBrowser: false });
        if (loginResult.success) {
          // 재로그인 후 v3 API로 다시 시도
          log('Worker', '재로그인 성공, v3 API 재시도');
          await doScrapeV3(data);
        }
      }
      break;

    case 'morning_briefing':
      // 항상 로그인 + 전체 스크래핑 (Playwright 사용)
      log('Worker', '로그인 후 Playwright 전체 스크래핑');
      const mbLoginResult = await doLogin(data, { returnBrowser: true });
      if (mbLoginResult.success) {
        await doScrape({ ...data, scrapeType: 'all' }, mbLoginResult);
        await mbLoginResult.browser.close();
        log('Worker', '브라우저 종료');
      }
      break;

    case 'rag':
      // v4.1.2: 온보딩 RAG 질의 (가이드 링크 자동 변환)
      log('Worker', 'RAG 질의 처리');
      const ragResult = await askRag(data.question, data.conversationHistory || []);

      // 답변에서 '가이드' 참조를 클릭 가능한 링크로 변환
      let processedAnswer = ragResult.answer;
      if (ragResult.sources && ragResult.sources.length > 0) {
        const firstSource = ragResult.sources[0];
        if (firstSource.url) {
          // 패턴: 'XXX 가이드'를 참조/참고 → 클릭 가능한 링크로
          // 예: 'SSL-VPN 사용자 가이드'를 참조 → <a href="...">가이드 링크</a>를 참조
          processedAnswer = processedAnswer.replace(
            /'[^']+\s*가이드'를?\s*(참조|참고)/g,
            `<a href="${firstSource.url}">가이드 링크</a>를 참고`
          );
          // {{가이드 링크}} 플레이스홀더도 처리
          processedAnswer = processedAnswer.replace(
            /\{\{가이드 링크\}\}/g,
            `<a href="${firstSource.url}">가이드 링크</a>`
          );
        }
      }

      await sendChatCard(data.spaceId, '📚 온보딩 가이드', processedAnswer, ragResult.sources);
      break;

    default:
      log('Worker', '알 수 없는 action:', data.action);
  }

  message.ack();
}

// ========== 메인 ==========
async function main() {
  log('Worker', '시작');
  log('Worker', `Project: ${CONFIG.PROJECT_ID}`);
  log('Worker', `Subscription: ${CONFIG.SUBSCRIPTION_NAME}`);

  const pubsub = new PubSub({ projectId: CONFIG.PROJECT_ID });
  const subscription = pubsub.subscription(CONFIG.SUBSCRIPTION_NAME);

  subscription.on('message', handleMessage);
  subscription.on('error', (err) => log('Worker', '에러:', err.message));

  log('Worker', '메시지 대기 중...');
}

main().catch(console.error);
