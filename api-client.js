/**
 * GW API Client - 쿠키 기반 직접 API 호출
 * v3.0: Playwright 없이 fetch로 API 직접 호출
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  COOKIE_PATH: path.join(__dirname, 'cookies.json'),
  USERINFO_PATH: path.join(__dirname, 'userinfo.json'),
  BASE_URL: 'https://gw.hancom.com',

  // API 엔드포인트
  API: {
    // 팀 현황
    EMP_LIST: '/ekp/service/organization/selectEmpList',
    // 연차
    LEAVE_BALANCE: '/ekp/service/attend/selectMyHolidayYearList',
    LEAVE_DETAIL: '/ekp/service/attend/absence/selectMyYearHolidayCnt',
    // 결재
    APPROVAL: '/ekp/service/eapp/selectAppList',
    APPROVAL_RSS: '/ekp/service/openapi/rss/eappTodoList',
    // 게시판
    BOARD_LIST: '/ekp/service/board/article/selectArticleList',
    BOARD_RSS: '/ekp/service/openapi/rss/brdArticleList',
    // 쪽지
    NOTE: '/ekp/service/not/selectNoteList',
    // 메일
    MAIL: '/ekp/service/openapi/rss/allUnReadMailCnt',
    // 예실
    BUDGET: '/ekp/service/budget/selectBudgetAmtList',
    // 사용자 정보
    USER_INFO: '/ekp/service/common/selectLoginUserInfo',
  },
};

// ========== 유틸 ==========
function log(tag, ...args) {
  const timestamp = new Date().toLocaleString('ko-KR');
  console.log(`[${timestamp}] [API:${tag}]`, ...args);
}

function loadCookies() {
  if (!fs.existsSync(CONFIG.COOKIE_PATH)) {
    throw new Error('쿠키 파일이 없습니다. 먼저 로그인해주세요.');
  }
  const cookies = JSON.parse(fs.readFileSync(CONFIG.COOKIE_PATH, 'utf-8'));

  // 필수 쿠키만 필터링 (브라우저처럼)
  const essentialCookies = ['JSESSIONID', 'SCOUTER', 'locale', 'AWSALB', 'AWSALBCORS', 'AWSALBTG', 'AWSALBTGCORS'];
  const filtered = cookies.filter(c => essentialCookies.some(name => c.name.startsWith(name)));

  log('Init', `쿠키 필터링: ${cookies.length}개 → ${filtered.length}개`);
  return filtered.map(c => `${c.name}=${c.value}`).join('; ');
}

// ========== API 클라이언트 ==========
class GwApiClient {
  constructor() {
    this.cookieString = null;
    this.userInfo = null;
  }

  async init() {
    this.cookieString = loadCookies();
    log('Init', `쿠키 로드 완료`);

    // 사용자 정보 가져오기
    this.userInfo = await this.getUserInfo();
    if (!this.userInfo) {
      throw new Error('세션 만료 - 다시 로그인해주세요');
    }
    log('Init', `사용자: ${this.userInfo.userName} (${this.userInfo.deptName})`);

    // 세션 유효성 간단히 검증 (팀 API 호출 시도)
    try {
      await this.validateSession();
    } catch (e) {
      log('Init', `세션 검증 실패: ${e.message}`);
      throw new Error('세션 만료 - 다시 로그인해주세요');
    }

    return this;
  }

  async validateSession() {
    // 간단한 API 호출로 세션 유효성 검증 (최소 헤더만)
    const response = await fetch(`${CONFIG.BASE_URL}${CONFIG.API.MAIL}`, {
      method: 'POST',
      headers: {
        'Cookie': this.cookieString,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Naonajax': 'xml',
      },
    });

    if (!response.ok) {
      throw new Error(`세션 검증 실패: ${response.status}`);
    }

    const text = await response.text();
    // 로그인 페이지로 리다이렉트되면 세션 만료
    if (text.includes('login') && text.includes('okta')) {
      throw new Error('세션 만료');
    }

    log('Init', '세션 유효함');
  }

  getHeaders(contentType = 'application/x-www-form-urlencoded', referer = null) {
    return {
      'Cookie': this.cookieString,
      'Content-Type': `${contentType}; charset=UTF-8`,
      'X-Requested-With': 'XMLHttpRequest',
      'Naonajax': 'json',
      'Accept': '*/*',
      'Origin': CONFIG.BASE_URL,
      'Referer': referer || `${CONFIG.BASE_URL}/ekp/scr/main/homGwMain`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    };
  }

  async fetchApi(endpoint, options = {}) {
    const url = `${CONFIG.BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(options.contentType, options.referer),
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API 에러: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    // JSON 파싱 시도
    try {
      return JSON.parse(text);
    } catch (e) {
      return text; // XML이나 HTML인 경우 텍스트 반환
    }
  }

  // ========== 사용자 정보 ==========
  async getUserInfo() {
    try {
      // 방법 0: userinfo.json 파일에서 로드 (로그인 시 저장됨)
      if (fs.existsSync(CONFIG.USERINFO_PATH)) {
        const userInfo = JSON.parse(fs.readFileSync(CONFIG.USERINFO_PATH, 'utf-8'));
        if (userInfo.empId && userInfo.deptId) {
          log('UserInfo', `파일에서 로드: ${userInfo.userName} (${userInfo.deptName})`);
          return userInfo;
        }
      }

      // 방법 1: 메인 페이지 HTML에서 loginUserInfo 추출
      log('UserInfo', '메인 페이지 접근 시도');
      const response = await fetch(`${CONFIG.BASE_URL}/ekp/scr/main/homGwMain`, {
        headers: {
          'Cookie': this.cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'manual', // 리다이렉트 방지
      });

      log('UserInfo', `응답 상태: ${response.status}`);

      // 리다이렉트면 세션 만료
      if (response.status === 302 || response.status === 301) {
        log('UserInfo', '리다이렉트됨 - 세션 만료');
        return null;
      }

      const html = await response.text();
      log('UserInfo', `HTML 길이: ${html.length}`);

      // 로그인 페이지로 리다이렉트 확인
      if (html.length < 1000 || (html.includes('login') && html.includes('okta'))) {
        log('UserInfo', '로그인 페이지 감지 - 세션 만료');
        return null;
      }

      // loginUserInfo 변수 추출 (여러 패턴 시도)
      const patterns = [
        /var\s+loginUserInfo\s*=\s*\{([^}]+)\}/s,
        /loginUserInfo\s*=\s*\{([^}]+)\}/s,
        /"empId"\s*:\s*"([^"]+)".*?"userName"\s*:\s*"([^"]+)".*?"deptId"\s*:\s*"([^"]+)"/s,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          log('UserInfo', `패턴 매칭 성공: ${match[0].substring(0, 100)}...`);
          break;
        }
      }

      // 개별 필드 추출
      const extractField = (name) => {
        // 다양한 형식 지원
        const patterns = [
          new RegExp(`['"]?${name}['"]?\\s*:\\s*['"]([^'"]+)['"]`, 'i'),
          new RegExp(`${name}\\s*=\\s*['"]([^'"]+)['"]`, 'i'),
          new RegExp(`${name}:\\s*['"]([^'"]+)['"]`, 'i'),
        ];
        for (const p of patterns) {
          const m = html.match(p);
          if (m) return m[1];
        }
        return '';
      };

      const userInfo = {
        empId: extractField('empId'),
        cmpId: extractField('cmpId'),
        userId: extractField('userId'),
        userName: extractField('userName'),
        deptId: extractField('deptId'),
        deptCd: extractField('deptCd'),
        deptName: extractField('deptName'),
      };

      log('UserInfo', `추출 결과: empId=${userInfo.empId}, userName=${userInfo.userName}, deptId=${userInfo.deptId}`);

      if (userInfo.empId && userInfo.deptId) {
        return userInfo;
      }

      // 방법 2: 세션 체크 API 시도
      log('UserInfo', '방법2: API 시도');
      try {
        const apiResponse = await fetch(`${CONFIG.BASE_URL}/ekp/service/common/selectLoginUserInfo`, {
          method: 'POST',
          headers: this.getHeaders(),
        });
        const apiResult = await apiResponse.text();
        log('UserInfo', `API 응답: ${apiResult.substring(0, 200)}`);

        if (apiResult && !apiResult.includes('error')) {
          const json = JSON.parse(apiResult);
          if (json.data) {
            return json.data;
          }
        }
      } catch (apiErr) {
        log('UserInfo', `API 실패: ${apiErr.message}`);
      }

      log('UserInfo', 'userInfo 추출 실패');
      return null;
    } catch (e) {
      log('UserInfo', '에러:', e.message);
      return null;
    }
  }

  // ========== 팀 현황 ==========
  async getTeamAttendance() {
    log('Team', 'API 호출 시작');

    const params = new URLSearchParams({
      orderMode: 'RANK_USERNAME',
      listType: 'list',
      'paging.pageNo': '1',
      'paging.listBlock': '50',
      deptId: this.userInfo.deptId,
      cmpId: this.userInfo.cmpId,
      subDeptYn: 'N',
      serviceType: 'org',
      afflMode: '',
      searchWord: '',
      typeSearch: '',
    });

    const result = await this.fetchApi(CONFIG.API.EMP_LIST, {
      method: 'POST',
      body: params.toString(),
    });

    const empList = result.data?.empList || result.empList || result.list || [];
    log('Team', `팀원 수: ${empList.length}`);

    // 상태 분류
    const ATN_STATUS = {
      working: ['출근', '재실', '근무'],
      offWork: ['퇴근'],
      leave: ['휴가', '연차', '월차', '경조휴가', '병가', '출산휴가', '육아휴직'],
      outside: ['외근', '출장', '외출'],
      halfDay: ['반차', '오전반차', '오후반차'],
      health: ['건강검진'],
      absent: ['결근', '미출근'],
    };

    const attendance = { working: [], offWork: [], leave: [], outside: [], halfDay: [], health: [] };

    empList.forEach((emp) => {
      const atnStatus = emp.empAtnStatus || '';
      const member = {
        name: emp.personBean?.userName || emp.userName || '이름없음',
        status: atnStatus,
      };

      let category = 'working';
      for (const [cat, keywords] of Object.entries(ATN_STATUS)) {
        if (keywords.some(kw => atnStatus.includes(kw))) {
          category = cat;
          break;
        }
      }

      if (attendance[category]) {
        attendance[category].push(member);
      }
    });

    return { totalMembers: empList.length, attendance };
  }

  // ========== 연차 ==========
  async getLeaveBalance() {
    log('Leave', 'API 호출 시작 (4단계 방식)');

    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    try {
      // 1단계: 메인 페이지 방문 (서버 세션 상태 설정)
      const mainPageResponse = await fetch(`${CONFIG.BASE_URL}/ekp/scr/attend/atnAttendMain`, {
        method: 'GET',
        headers: {
          'Cookie': this.cookieString,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        },
      });
      if (!mainPageResponse.ok) {
        log('Leave', `1단계(메인페이지) 실패: ${mainPageResponse.status}`);
      } else {
        log('Leave', '1단계: atnAttendMain 페이지 방문 완료');
      }

      // 2단계: 사이드바 초기화 (세션 상태 설정)
      const sidebarResponse = await fetch(`${CONFIG.BASE_URL}/ekp/inc/attend/atnAttendSideBar`, {
        method: 'POST',
        headers: {
          'Cookie': this.cookieString,
          'X-Requested-With': 'XMLHttpRequest',
          'Naonajax': 'html',
          'Referer': `${CONFIG.BASE_URL}/ekp/scr/attend/atnAttendMain`,
        },
      });
      if (!sidebarResponse.ok) {
        log('Leave', `2단계 실패: ${sidebarResponse.status}`);
      } else {
        log('Leave', '2단계: atnAttendSideBar 초기화 완료');
      }

      // 3단계: loginUserInfo (사용자 인증)
      await this.fetchApi('/ekp/service/attend/loginUserInfo', {
        method: 'POST',
        body: '',
        referer: `${CONFIG.BASE_URL}/ekp/scr/attend/atnAttendMain`,
      });
      log('Leave', '3단계: loginUserInfo 완료');

      // 4단계: selectMyYearHoliday (연차 조회)
      // 브라우저 캡처: __REQ_JSON_OBJECT__=URL인코딩JSON 형식
      const requestBody = {
        selectedYear: year,
        selectedMonth: month,
        cmpId: this.userInfo.cmpId,
        empId: this.userInfo.empId,
      };
      log('Leave', `요청 파라미터: ${JSON.stringify(requestBody)}`);

      // URLSearchParams로 올바른 form-encoding 사용
      const params = new URLSearchParams();
      params.append('__REQ_JSON_OBJECT__', JSON.stringify(requestBody));

      const result = await this.fetchApi('/ekp/service/attend/selectMyYearHoliday', {
        method: 'POST',
        body: params.toString(),
        referer: `${CONFIG.BASE_URL}/ekp/scr/attend/atnAttendMain`,
      });

      log('Leave', '4단계 응답:', JSON.stringify(result).substring(0, 500));

      // 응답 파싱 - data 객체에서 직접 추출
      if (result.data) {
        const d = result.data;

        // 연차: totYhldCnt(발생), useYhldCnt(사용), remdYhldCnt(잔여)
        const total = parseFloat(d.totYhldCnt || 0);
        const used = parseFloat(d.useYhldCnt || 0);
        const remaining = parseFloat(d.remdYhldCnt || (total - used));

        // 특별휴가/보상휴가/포상휴가
        const specialRemaining = parseFloat(d.remdSpclCnt || 0);
        const rewardRemaining = parseFloat(d.remdRewdCnt || 0);
        const prizeRemaining = parseFloat(d.remdPrizCnt || 0);

        // 포상휴가 정보
        const prizeTotal = parseFloat(d.prizHldCnt || 0);
        const prizeUsed = parseFloat(d.usePrizCnt || (prizeTotal - prizeRemaining));

        log('Leave', `결과: 연차 총=${total}, 사용=${used}, 잔여=${remaining}`);
        log('Leave', `포상휴가: 총=${prizeTotal}, 사용=${prizeUsed}, 잔여=${prizeRemaining}`);
        log('Leave', `특별=${specialRemaining}, 보상=${rewardRemaining}`);

        return {
          total,
          used,
          remaining,
          specialRemaining,
          rewardRemaining,
          prizeRemaining,
          prizeTotal,
          prizeUsed,
        };
      }
    } catch (e) {
      log('Leave', '에러:', e.message);
    }

    return { total: 0, used: 0, remaining: 0, specialRemaining: 0, rewardRemaining: 0, prizeRemaining: 0, prizeTotal: 0, prizeUsed: 0 };
  }

  // ========== 결재 ==========
  async getApproval() {
    log('Approval', 'API 호출 시작');

    // 방법 1: selectAppList
    try {
      const jsonBody = JSON.stringify({
        appType: 'TODO',
        pageNo: 1,
        listCnt: 50,
      });

      const result = await this.fetchApi(CONFIG.API.APPROVAL, {
        method: 'POST',
        contentType: 'application/json',
        body: `__REQ_JSON_OBJECT__${jsonBody}`,
      });

      const list = result.data?.list || result.list || [];
      const totalCount = result.data?.paging?.totalCount || list.length;
      log('Approval', `미결: ${totalCount}건`);
      return { pending: totalCount, list };
    } catch (e) {
      log('Approval', '방법1 실패:', e.message);
    }

    // 방법 2: RSS API
    try {
      const result2 = await this.fetchApi(CONFIG.API.APPROVAL_RSS, {
        method: 'GET',
      });

      if (typeof result2 === 'string') {
        const itemMatches = result2.match(/<item>/gi);
        return { pending: itemMatches ? itemMatches.length : 0 };
      }

      const list = result2.data?.list || result2.list || [];
      return { pending: list.length };
    } catch (e) {
      log('Approval', '방법2 실패:', e.message);
    }

    return { pending: 0 };
  }

  // ========== 게시판 ==========
  async getBoard() {
    log('Board', 'API 호출 시작 (3단계 방식)');

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

    try {
      // 1단계: 게시판 메인 페이지 방문 (세션 초기화)
      const boardMainUrl = `${CONFIG.BASE_URL}/ekp/scr/board/boardMain?at=TU5VMjc3NjAyMDAwMTk5NzgxOTI1Nzk%3D`;
      const mainPageResponse = await fetch(boardMainUrl, {
        method: 'GET',
        headers: {
          'Cookie': this.cookieString,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        },
      });
      if (!mainPageResponse.ok) {
        log('Board', `1단계(메인페이지) 실패: ${mainPageResponse.status}`);
      } else {
        log('Board', '1단계: boardMain 페이지 방문 완료');
      }

      // 2단계: selectArticleList API
      // 브라우저 캡처: {"param":{"brdId":"BBA","counting":"Y"}}
      const requestBody = {
        param: {
          brdId: 'BBA',  // 공지사항
          counting: 'Y',
        }
      };
      log('Board', `요청 파라미터: ${JSON.stringify(requestBody)}`);

      // URLSearchParams로 올바른 form-encoding 사용
      const params = new URLSearchParams();
      params.append('__REQ_JSON_OBJECT__', JSON.stringify(requestBody));

      const result = await this.fetchApi(CONFIG.API.BOARD_LIST, {
        method: 'POST',
        body: params.toString(),
        referer: boardMainUrl,
      });

      log('Board', '응답:', JSON.stringify(result).substring(0, 500));

      // atclList에서 게시글 추출
      const articles = result.data?.atclList || result.data?.list || [];
      const recentPosts = articles
        .filter(a => {
          const date = a.regDt || a.createDate || '';
          return date.startsWith(todayStr) || date.startsWith(yesterdayStr);
        })
        .slice(0, 10)
        .map(a => ({
          title: (a.subject || a.atclTitle || a.title || '').substring(0, 40),
          date: (a.regDt || a.createDate || '').substring(0, 10),
          link: a.atclId ? `https://gw.hancom.com/ekp/view/board/article/brdAtclViewPopup?atclId=${a.atclId}` : '',
        }));

      log('Board', `결과: 최근 게시글 ${recentPosts.length}건`);
      return { unreadCount: recentPosts.length, recentPosts };
    } catch (e) {
      log('Board', '에러:', e.message);
    }

    // 폴백: RSS API
    try {
      const rssUrl = `${CONFIG.API.BOARD_RSS}?boardId=BBA&listCnt=20`;
      const result2 = await this.fetchApi(rssUrl, { method: 'GET' });

      if (typeof result2 === 'string') {
        const items = [];
        const itemRegex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>(.+?)<\/pubDate>[\s\S]*?<\/item>/gi;
        let match;
        while ((match = itemRegex.exec(result2)) !== null) {
          items.push({ title: match[1].substring(0, 40), date: match[2] });
        }
        return { unreadCount: items.length, recentPosts: items.slice(0, 10) };
      }
    } catch (e) {
      log('Board', '방법2 실패:', e.message);
    }

    return { unreadCount: 0, recentPosts: [] };
  }

  // ========== 쪽지 ==========
  async getNote() {
    log('Note', 'API 호출 시작');

    const result = await this.fetchApi(CONFIG.API.NOTE, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        noteType: '2',
        param: {
          boxType: 'RECV_NOTE_NOTIC_LIST',
          readYn: 'N',
          listCnt: 50,
          pageNo: 0,
          incPrevNext: true,
        },
      }),
    });

    const totalCount = result.data?.paging?.totalCount || 0;
    log('Note', `안 읽은 쪽지: ${totalCount}건`);
    return { unreadCount: totalCount };
  }

  // ========== 메일 ==========
  async getMail() {
    log('Mail', 'API 호출 시작');

    const result = await this.fetchApi(`${CONFIG.API.MAIL}?dataType=xml&sysMenuMode=1&sessionFromServer=Y`, {
      method: 'POST',
      headers: { 'Naonajax': 'xml' },
    });

    let unreadCount = 0;
    if (typeof result === 'string') {
      const countMatch = result.match(/<description><!\[CDATA\[(\d+)\]\]><\/description>/);
      unreadCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    }

    log('Mail', `안 읽은 메일: ${unreadCount}건`);
    return { unreadCount };
  }

  // ========== 예실 ==========
  async getBudget() {
    log('Budget', 'API 호출 시작 (3단계 방식)');

    const now = new Date();
    const year = now.getFullYear();
    const monthNum = now.getMonth() + 1;

    // 분기 계산 (시작월, 종료월)
    let quarter, startMonth, endMonth;
    if (monthNum <= 3) {
      quarter = 1; startMonth = '01'; endMonth = '03';
    } else if (monthNum <= 6) {
      quarter = 2; startMonth = '04'; endMonth = '06';
    } else if (monthNum <= 9) {
      quarter = 3; startMonth = '07'; endMonth = '09';
    } else {
      quarter = 4; startMonth = '10'; endMonth = '12';
    }

    const startDate = `${year}${startMonth}`; // YYYYMM
    const endDate = `${year}${endMonth}`;     // YYYYMM

    try {
      // 1단계: 메인 페이지 방문 (서버 세션 상태 설정)
      // Playwright 캡처: 브라우저가 먼저 이 페이지를 로드함
      const mainPageResponse = await fetch(`${CONFIG.BASE_URL}/ekp/view/budget/budgetMain`, {
        method: 'GET',
        headers: {
          'Cookie': this.cookieString,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        },
      });
      if (!mainPageResponse.ok) {
        log('Budget', `1단계(메인페이지) 실패: ${mainPageResponse.status}`);
      } else {
        log('Budget', '1단계: budgetMain 페이지 방문 완료');
      }

      // 2단계: budgetAmtList 페이지 호출 (AJAX 초기화)
      const initResponse = await fetch(`${CONFIG.BASE_URL}/ekp/inc/budget/budgetAmtList`, {
        method: 'POST',
        headers: {
          'Cookie': this.cookieString,
          'X-Requested-With': 'XMLHttpRequest',
          'Naonajax': 'html',
          'Referer': `${CONFIG.BASE_URL}/ekp/view/budget/budgetMain`,
        },
      });
      if (!initResponse.ok) {
        log('Budget', `2단계 실패: ${initResponse.status}`);
      } else {
        log('Budget', '2단계: budgetAmtList 세션 초기화 완료');
      }

      // 3단계: selectSysDate (시스템 날짜)
      await this.fetchApi('/ekp/service/budget/selectSysDate', {
        method: 'POST',
        body: '',
      });
      log('Budget', '3단계: selectSysDate 완료');

      // 4단계: __REQ_JSON_OBJECT__ 형식으로 예실 조회 (분기별)
      // 브라우저 캡처: __REQ_JSON_OBJECT__=URL인코딩JSON 형식으로 전송
      const requestBody = {
        deptCd: this.userInfo.deptCd,
        deptName: this.userInfo.deptName,
        subDeptYn: '0',
        startDate: startDate,
        endDate: endDate,
      };
      log('Budget', `요청 파라미터: ${JSON.stringify(requestBody)}`);

      // URLSearchParams로 올바른 form-encoding 사용
      const params = new URLSearchParams();
      params.append('__REQ_JSON_OBJECT__', JSON.stringify(requestBody));

      const result = await this.fetchApi(CONFIG.API.BUDGET, {
        method: 'POST',
        body: params.toString(),
        referer: `${CONFIG.BASE_URL}/ekp/view/budget/budgetMain`,
      });

      log('Budget', '응답:', JSON.stringify(result).substring(0, 500));

      // data가 배열로 바로 옴
      const items = result.data || [];

      // 콤마 제거하고 숫자로 변환하는 헬퍼
      const parseAmt = (str) => parseInt((str || '0').replace(/,/g, ''), 10);

      // 합계 행 찾기 (deptCd: "999999999")
      const totalRow = items.find(item => item.deptCd === '999999999');
      const budgetItems = [];

      // 개별 항목 (합계 제외)
      items.forEach(item => {
        if (item.deptCd === '999999999') return; // 합계 행 스킵
        if (!item.accNm) return; // 계정명 없으면 스킵

        budgetItems.push({
          account: item.accNm,
          budget: item.bgtAmt || '0',
          spent: item.slipAmt || '0',
          remaining: item.remAmt || '0',
        });
      });

      // 합계 (totalRow가 있으면 사용, 없으면 직접 계산)
      let totalBudget, totalSpent, totalRemaining;
      if (totalRow) {
        totalBudget = parseAmt(totalRow.bgtAmt);
        totalSpent = parseAmt(totalRow.slipAmt);
        totalRemaining = parseAmt(totalRow.remAmt);
      } else {
        totalBudget = budgetItems.reduce((sum, i) => sum + parseAmt(i.budget), 0);
        totalSpent = budgetItems.reduce((sum, i) => sum + parseAmt(i.spent), 0);
        totalRemaining = budgetItems.reduce((sum, i) => sum + parseAmt(i.remaining), 0);
      }

      log('Budget', `결과: 예산=${totalBudget}, 집행=${totalSpent}, 잔액=${totalRemaining}, 항목=${budgetItems.length}개`);

      return {
        year,
        quarter,
        month: monthNum,
        period: `${year}년 ${quarter}분기 (${startMonth}~${endMonth}월)`,
        budget: totalBudget.toLocaleString('ko-KR'),
        spent: totalSpent.toLocaleString('ko-KR'),
        remaining: totalRemaining.toLocaleString('ko-KR'),
        budgetNum: totalBudget,
        spentNum: totalSpent,
        remainingNum: totalRemaining,
        items: budgetItems,
      };
    } catch (e) {
      log('Budget', '에러:', e.message);
      return null;
    }
  }

  // ========== 전체 스크래핑 ==========
  async scrapeAll() {
    log('All', '전체 스크래핑 시작');

    const [team, leave, approval, board, note, mail, budget] = await Promise.all([
      this.getTeamAttendance().catch(e => { log('All', `팀: ${e.message}`); return null; }),
      this.getLeaveBalance().catch(e => { log('All', `연차: ${e.message}`); return null; }),
      this.getApproval().catch(e => { log('All', `결재: ${e.message}`); return null; }),
      this.getBoard().catch(e => { log('All', `게시판: ${e.message}`); return null; }),
      this.getNote().catch(e => { log('All', `쪽지: ${e.message}`); return null; }),
      this.getMail().catch(e => { log('All', `메일: ${e.message}`); return null; }),
      this.getBudget().catch(e => { log('All', `예실: ${e.message}`); return null; }),
    ]);

    return { team, leave, approval, board, note, mail, budget };
  }
}

module.exports = { GwApiClient, CONFIG };
