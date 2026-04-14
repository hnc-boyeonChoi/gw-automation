/**
 * org-search.js - 조직도 검색 유틸리티 (v4.3)
 * 테스트 가능한 순수 함수들
 */

// ========== 검색어 추출 ==========

/**
 * 담당업무 검색용 검색어 추출
 */
function extractDutySearchTerm(query) {
  const stopWords = [
    '누구야', '누구에요', '누구', '뭐야', '뭐에요', '알려줘', '찾아줘',
    '검색', '있어', '찾고', '싶어', '보여줘', '어디', '어느',
    '담당', '담당자', '담당업무', '업무'
  ];

  let term = query;
  stopWords.forEach(word => {
    term = term.replace(new RegExp(word, 'gi'), '');
  });

  term = term.replace(/[?!.,]/g, '');
  term = term.replace(/\s+/g, ' ').trim();

  return term || query;
}

/**
 * 쿼리에서 검색어 추출
 */
function extractSearchTerm(query) {
  // 단독으로만 제거할 단어들 (이름에 포함된 경우 제거하지 않음)
  const stopWords = [
    '누구야', '누구에요', '누구', '뭐야', '뭐에요', '알려줘', '찾아줘',
    '검색', '내선', '번호', '전화', '연락처', '이메일', '메일',
    '조직도', '직책', '있어', '뭐해', '오늘',
    '했어', '했나요', '중이야'
  ];

  // 공백으로 구분된 단독 단어만 제거 (이름에 포함된 경우 보존)
  const boundaryWords = ['출근', '퇴근', '상태', '근무'];

  let term = query;

  // 일반 불용어 제거
  stopWords.forEach(word => {
    term = term.replace(new RegExp(word, 'gi'), '');
  });

  // 단독 단어만 제거 (앞뒤가 공백이거나 문장 끝인 경우)
  boundaryWords.forEach(word => {
    term = term.replace(new RegExp(`(^|\\s)${word}($|\\s)`, 'gi'), ' ');
  });

  term = term.replace(/님/g, '');
  term = term.replace(/[?!.,]/g, '');
  term = term.replace(/\s+/g, ' ').trim();

  return term || query;
}

// ========== 검색 타입 감지 ==========

/**
 * 검색 타입 감지 (name / duty)
 */
function detectSearchType(query) {
  // 이름 검색 패턴
  const namePattern = /[가-힣]{2,4}(님|씨)?(\s|$)/;
  // 역할/제품 검색 패턴
  const dutyPattern = /PO|PM|TL|PoC|QA|팀장|파트장|실장|담당자|리더/i;

  if (dutyPattern.test(query) && !namePattern.test(query.replace(/[가-힣]+[팀실부]/, ''))) {
    return 'duty';
  }
  return 'name';
}

// ========== 쿼리 파싱 ==========

/**
 * 이름 검색 쿼리 파싱
 * @param {string} query - 검색 쿼리
 * @returns {{ name: string, teamHint: string|null }}
 */
function parseNameQuery(query) {
  let cleaned = extractSearchTerm(query);

  // 한글 이름 패턴 (2~4글자)
  const nameMatch = cleaned.match(/[가-힣]{2,4}/g);
  // 팀/부서 힌트 패턴
  const teamMatch = cleaned.match(/[가-힣]+(?:팀|실|부|본부|센터)/);

  let name = null;
  let teamHint = null;

  if (teamMatch) {
    teamHint = teamMatch[0];
    const withoutTeam = cleaned.replace(teamHint, '').trim();
    const remainingName = withoutTeam.match(/[가-힣]{2,4}/);
    if (remainingName) {
      name = remainingName[0];
    }
  } else if (nameMatch) {
    name = nameMatch[0];
  }

  return { name: name || cleaned, teamHint };
}

/**
 * 조직도 쿼리 파싱 (제품명 + 역할)
 * @param {string} query - 검색 쿼리
 * @returns {{ product: string, role: string|null, roles: string[] }}
 */
function parseOrgQuery(query) {
  const englishRoles = ['PO', 'PM', 'TL', 'PoC', 'POC', 'QA', 'SE', 'SA'];
  const koreanRoles = ['팀장', '파트장', '실장', '센터장', '본부장', '그룹장', '리더', '담당자'];

  let roles = [];
  let product = query;

  // 영문 역할 추출
  for (const keyword of englishRoles) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    if (regex.test(query)) {
      roles.push(keyword.toUpperCase());
      product = product.replace(new RegExp(`\\b${keyword}(님|이나|이랑|또는|,|\\s)*`, 'gi'), ' ');
    }
  }

  // 한글 역할 추출
  for (const keyword of koreanRoles) {
    const regex = new RegExp(`${keyword}(님)?(이나|이랑|또는|,)?`, 'g');
    if (regex.test(query)) {
      if (!roles.includes(keyword)) {
        roles.push(keyword);
      }
      product = product.replace(regex, ' ');
    }
  }

  product = extractDutySearchTerm(product);
  product = product.replace(/님/g, '').replace(/\s+/g, ' ').trim();

  const role = roles.length > 0 ? roles[0] : null;

  return { product, role, roles };
}

// ========== 상태 파싱 ==========

/**
 * 근무 상태 텍스트 해석
 * @param {string} status - 근무 상태 문자열
 * @returns {{ type: string, text: string, icon: string }}
 */
function parseStatus(status) {
  if (!status) return { type: 'unknown', text: '확인 불가', icon: '⚪' };
  const s = status.toLowerCase();

  // 순서 중요: 더 구체적인 패턴 먼저 체크
  if (s.includes('재택')) {
    return { type: 'remote', text: '재택근무 중입니다', icon: '🏠' };
  }
  if (s.includes('출근') || s.includes('재실')) {
    return { type: 'working', text: '출근 중', icon: '🟢' };
  }
  if (s.includes('근무') && !s.includes('재택')) {
    return { type: 'working', text: '출근 중', icon: '🟢' };
  }
  if (s.includes('퇴근') || s.includes('업무종료')) {
    return { type: 'left', text: '퇴근했습니다', icon: '🔵' };
  }
  if (s.includes('연차') || s.includes('휴가')) {
    return { type: 'leave', text: '연차입니다', icon: '🟡' };
  }
  if (s.includes('휴직')) {
    return { type: 'absent', text: '휴직 중입니다', icon: '🟠' };
  }
  if (s.includes('병가')) {
    return { type: 'sick', text: '병가 중입니다', icon: '🔴' };
  }
  if (s.includes('출장')) {
    return { type: 'trip', text: '출장 중입니다', icon: '🟣' };
  }
  if (s.includes('외근')) {
    return { type: 'outside', text: '외근 중입니다', icon: '🟤' };
  }
  if (s.includes('반차')) {
    return { type: 'halfday', text: '반차입니다', icon: '🟡' };
  }

  return { type: 'other', text: status, icon: '⚪' };
}

// ========== 질문 패턴 ==========

const QUERY_PATTERNS = {
  // Yes/No 질문
  yesNo: /이야\??|인가요?\??|맞아\??|야\?$|에요\??|입니까\??|이셔\??|셔\?$|이세요\??|세요\?$|이신가요\??|인가\??|했어\??|했나요?\??|했습니까\??|중이야\??|중이에요\??|중인가요?\??/,

  // 근무 상태 관련
  status: /근무\s*상태|상태\s*뭐|어때|어떄/,
  // v4.3.1: 회사/사무실/자리 패턴 추가
  checkIn: /출근\s*(했|중|상태)|나왔|회사\s*(계|있|에)|사무실\s*(계|있|에)|자리에\s*(계|있)/,
  checkOut: /퇴근\s*(했|중|상태)|갔어|들어갔/,
  leave: /연차|휴가|쉬어|쉬는/,
  absent: /휴직|병가|출장/,

  // 연락처 관련
  email: /메일|이메일/,
  phone: /내선|번호|전화/,
  mobile: /핸드폰|휴대폰|휴대전화|폰\s*번호|연락처/,

  // 소속/직책 관련
  team: /어느\s*팀|어디\s*팀|소속|부서/,
  duty: /담당|업무|뭐\s*해|뭐\s*하|하는\s*일/,
  position: /직책|직급|무슨\s*자리/,

  // 일반
  who: /누구/,
};

// ========== 응답 포맷팅 ==========

/**
 * 조직도 검색 결과 포맷팅
 * @param {Array} employees - 직원 목록
 * @param {string} query - 검색 쿼리
 * @param {Object} options - 옵션 { role }
 * @returns {string}
 */
function formatOrgSearchResult(employees, query, options = {}) {
  if (!employees || employees.length === 0) {
    const lines = [`🔍 *조직도 검색 결과*\n`, `검색 결과가 없습니다.`];
    const askedRole = options.role || '';
    if (askedRole) {
      lines.push(`\n💡 *힌트*: "${askedRole} 담당자 누구야?"로 전체 검색해보세요.`);
    }
    return lines.join('\n');
  }

  const patterns = QUERY_PATTERNS;
  const askedRole = options.role || '';

  // 직접 답변 생성 (Yes/No 질문 또는 정보 요청)
  const lines = [];

  // v4.3.1: Yes/No 질문 처리 (답변 후 카드도 표시)
  const isStatusQuestion = patterns.checkIn.test(query) || patterns.checkOut.test(query) || patterns.leave.test(query);

  if (patterns.yesNo.test(query) && employees.length === 1) {
    const emp = employees[0];
    const statusInfo = parseStatus(emp.status);

    // 출근 여부 질문
    if (patterns.checkIn.test(query)) {
      if (statusInfo.type === 'working') {
        lines.push(`✅ *네*, ${emp.name}님은 ${statusInfo.icon} *출근 중*입니다.\n`);
      } else {
        lines.push(`❌ *아니오*, ${emp.name}님은 ${statusInfo.icon} *${statusInfo.text}*\n`);
      }
    }
    // 퇴근 여부 질문
    else if (patterns.checkOut.test(query)) {
      if (statusInfo.type === 'left') {
        lines.push(`✅ *네*, ${emp.name}님은 ${statusInfo.icon} *퇴근했습니다*.\n`);
      } else {
        lines.push(`❌ *아니오*, ${emp.name}님은 ${statusInfo.icon} *${statusInfo.text}*\n`);
      }
    }
    // 휴가 여부 질문
    else if (patterns.leave.test(query)) {
      if (statusInfo.type === 'leave') {
        lines.push(`✅ *네*, ${emp.name}님은 ${statusInfo.icon} *연차 중*입니다.\n`);
      } else {
        lines.push(`❌ *아니오*, ${emp.name}님은 ${statusInfo.icon} *${statusInfo.text}*\n`);
      }
    }
    // 직책 여부 질문
    else if (askedRole) {
      const hasRole = (emp.office && emp.office.includes(askedRole)) ||
                      (emp.duty && emp.duty.includes(askedRole));
      if (hasRole) {
        lines.push(`✅ *네*, ${emp.name}님은 ${emp.deptName}의 *${askedRole}*입니다.\n`);
      } else {
        lines.push(`❌ *아니오*, ${emp.name}님은 ${askedRole}이 아닙니다.\n`);
      }
    }
  }
  // v4.3.1: 동명이인 Yes/No 질문 - 각자 상태 요약
  else if (isStatusQuestion && employees.length > 1) {
    const searchName = parseNameQuery(query).name || '해당 이름';
    lines.push(`👥 *${searchName}*님이 ${employees.length}명 있습니다:\n`);
    employees.slice(0, 5).forEach((emp) => {
      const statusInfo = parseStatus(emp.status);
      lines.push(`• ${emp.name} (${emp.deptName}) - ${statusInfo.icon} ${statusInfo.text}`);
    });
    if (employees.length > 5) {
      lines.push(`  외 ${employees.length - 5}명...`);
    }
    lines.push('');
  }

  // v4.3.1: Yes/No가 아닌 직접 정보 요청 처리
  if (employees.length === 1 && lines.length === 0) {
    const emp = employees[0];
    const statusInfo = parseStatus(emp.status);

    // "상태 뭐야?" 같은 직접 질문 (Yes/No 아닌 경우)
    if (patterns.status.test(query) || patterns.checkIn.test(query) || patterns.checkOut.test(query)) {
      lines.push(`${statusInfo.icon} ${emp.name}님은 *${statusInfo.text}*\n`);
    } else if (patterns.email.test(query)) {
      if (emp.email) {
        lines.push(`✉️ *${emp.email}* 입니다.\n`);
      } else {
        lines.push(`✉️ ${emp.name}님의 메일 정보가 없습니다.\n`);
      }
    } else if (patterns.phone.test(query)) {
      if (emp.phone) {
        lines.push(`📞 *${emp.phone}* 입니다.\n`);
      } else {
        lines.push(`📞 ${emp.name}님의 내선 정보가 없습니다.\n`);
      }
    } else if (patterns.mobile.test(query)) {
      if (emp.mobile) {
        lines.push(`📱 *${emp.mobile}* 입니다.\n`);
      } else if (emp.phone) {
        lines.push(`📱 휴대폰은 없고, 내선은 *${emp.phone}* 입니다.\n`);
      } else {
        lines.push(`📱 ${emp.name}님의 연락처 정보가 없습니다.\n`);
      }
    } else if (patterns.team.test(query)) {
      lines.push(`📍 *${emp.deptName}* 소속입니다.\n`);
    } else if (patterns.duty.test(query)) {
      if (emp.duty) {
        lines.push(`💼 *${emp.duty}* 담당입니다.\n`);
      } else {
        lines.push(`💼 ${emp.name}님의 담당업무 정보가 없습니다.\n`);
      }
    } else if (patterns.position.test(query)) {
      if (emp.office) {
        lines.push(`👔 *${emp.office}* 입니다.\n`);
      } else {
        lines.push(`👔 ${emp.name}님의 직책 정보가 없습니다.\n`);
      }
    } else if (patterns.who.test(query)) {
      const role = emp.office || emp.duty || '';
      if (role) {
        lines.push(`👤 *${emp.name}*님 (${role})입니다.\n`);
      } else {
        lines.push(`👤 *${emp.name}*님입니다.\n`);
      }
    }
  } else if (employees.length > 1 && patterns.who.test(query)) {
    const names = employees.slice(0, 5).map(e => e.name).join(', ');
    const suffix = employees.length > 5 ? ` 외 ${employees.length - 5}명` : '';
    lines.push(`👥 *${names}*${suffix} 입니다.\n`);
  }

  // 직원 정보 카드 (v4.3.1: 답변 있을 때만 구분선 표시)
  if (lines.length > 0) {
    lines.push(`───────────────────`);
  }
  lines.push(`🔍 *검색 결과* | ${employees.length}명\n`);

  employees.slice(0, 10).forEach((emp, idx) => {
    lines.push(`${idx + 1}. *${emp.name}*`);

    const validPosition = emp.position && emp.position !== '님' && emp.position.trim().length > 1;
    if (validPosition) {
      lines.push(`   📍 ${emp.deptName} / ${emp.position}`);
    } else {
      lines.push(`   📍 ${emp.deptName}`);
    }

    if (emp.office && emp.office.trim().length > 0) {
      lines.push(`   👔 ${emp.office}`);
    }

    if (emp.duty) {
      lines.push(`   💼 ${emp.duty}`);
    }

    if (patterns.phone.test(query) && emp.phone) {
      lines.push(`   📞 *${emp.phone}*`);
    } else if (emp.phone) {
      lines.push(`   📞 ${emp.phone}`);
    }

    if (emp.mobile) {
      lines.push(`   📱 ${emp.mobile}`);
    }

    if (emp.email) {
      lines.push(`   ✉️ ${emp.email}`);
    }

    if (emp.status) {
      const statusInfo = parseStatus(emp.status);
      lines.push(`   ${statusInfo.icon} ${emp.status}`);
    }

    lines.push('');
  });

  if (employees.length > 10) {
    lines.push(`... 외 ${employees.length - 10}명`);
  }

  return lines.join('\n');
}

// ========== 모듈 내보내기 ==========
module.exports = {
  extractSearchTerm,
  extractDutySearchTerm,
  detectSearchType,
  parseNameQuery,
  parseOrgQuery,
  parseStatus,
  formatOrgSearchResult,
  QUERY_PATTERNS,
};
