/**
 * org-search.test.js - 조직도 검색 유틸리티 테스트
 * Coverage target: 87%+
 */

const {
  extractSearchTerm,
  extractDutySearchTerm,
  detectSearchType,
  parseNameQuery,
  parseOrgQuery,
  parseStatus,
  formatOrgSearchResult,
  QUERY_PATTERNS,
} = require('./org-search');

// ========== extractSearchTerm ==========
describe('extractSearchTerm', () => {
  test('이름에서 "님" 제거', () => {
    expect(extractSearchTerm('김철수님')).toBe('김철수');
  });

  test('불필요한 단어 제거', () => {
    expect(extractSearchTerm('김철수 내선번호 알려줘')).toBe('김철수');
    expect(extractSearchTerm('홍길동 메일 뭐야?')).toBe('홍길동');
  });

  test('특수문자 제거', () => {
    expect(extractSearchTerm('김철수?!')).toBe('김철수');
  });

  test('공백 정리', () => {
    expect(extractSearchTerm('김철수   홍길동')).toBe('김철수 홍길동');
  });

  test('이름 유지 (상태 관련 단어와 구분)', () => {
    // "명상태"에서 "상태"가 이름의 일부로 유지됨
    expect(extractSearchTerm('명상태님 퇴근했나요?')).toContain('명상태');
    // 이름 + 님 처리
    expect(extractSearchTerm('최준성님 메일')).toBe('최준성');
  });

  test('빈 결과시 원본 반환', () => {
    expect(extractSearchTerm('알려줘')).toBe('알려줘');
  });
});

// ========== extractDutySearchTerm ==========
describe('extractDutySearchTerm', () => {
  test('담당 관련 단어 제거', () => {
    const result = extractDutySearchTerm('어시스턴트 담당자 누구야?');
    expect(result).toContain('어시스턴트');
  });

  test('검색 관련 단어 제거', () => {
    const result = extractDutySearchTerm('오피스 PO 찾아줘');
    expect(result).toContain('오피스');
    expect(result).toContain('PO');
  });
});

// ========== detectSearchType ==========
describe('detectSearchType', () => {
  test('이름 검색 감지', () => {
    expect(detectSearchType('김철수 내선번호')).toBe('name');
    expect(detectSearchType('홍길동님')).toBe('name');
    expect(detectSearchType('최준성')).toBe('name');
  });

  test('역할 검색 감지', () => {
    // 영문 역할만 있을 때 duty
    expect(detectSearchType('PO 누구야?')).toBe('duty');
    expect(detectSearchType('QA')).toBe('duty');
  });

  test('이름 + 역할 = name 우선', () => {
    expect(detectSearchType('김철수 팀장이야?')).toBe('name');
  });
});

// ========== parseNameQuery ==========
describe('parseNameQuery', () => {
  test('단순 이름 파싱', () => {
    const result = parseNameQuery('김철수 내선번호');
    expect(result.name).toBe('김철수');
    expect(result.teamHint).toBeNull();
  });

  test('이름 + 님 파싱', () => {
    const result = parseNameQuery('홍길동님 메일 뭐야?');
    expect(result.name).toBe('홍길동');
  });

  test('팀명 + 이름 파싱', () => {
    const result = parseNameQuery('개발팀 김철수 내선번호');
    expect(result.name).toBe('김철수');
    expect(result.teamHint).toBe('개발팀');
  });

  test('2글자 이름 파싱', () => {
    const result = parseNameQuery('준성님 출근했어?');
    expect(result.name).toBe('준성');
  });

  test('4글자 이름 파싱', () => {
    const result = parseNameQuery('제갈공명 연락처');
    expect(result.name).toBe('제갈공명');
  });

  test('팀명만 있는 경우', () => {
    const result = parseNameQuery('개발팀');
    expect(result.teamHint).toBe('개발팀');
  });
});

// ========== parseOrgQuery ==========
describe('parseOrgQuery', () => {
  test('제품 + 영문 역할 파싱', () => {
    const result = parseOrgQuery('어시스턴트 PO 누구야?');
    expect(result.product).toBe('어시스턴트');
    expect(result.role).toBe('PO');
    expect(result.roles).toContain('PO');
  });

  test('제품 + 한글 역할 파싱', () => {
    const result = parseOrgQuery('개발팀 팀장 누구야?');
    expect(result.product).toContain('개발');
    expect(result.role).toBe('팀장');
  });

  test('복수 역할 파싱 (이나)', () => {
    const result = parseOrgQuery('오피스 PM이나 PO 누구야?');
    expect(result.roles).toContain('PM');
    expect(result.roles).toContain('PO');
  });

  test('복수 역할 파싱 (또는)', () => {
    const result = parseOrgQuery('어시스턴트 TL 또는 PM');
    expect(result.roles).toContain('TL');
    expect(result.roles).toContain('PM');
  });

  test('PoC 역할 파싱 (대소문자)', () => {
    const result = parseOrgQuery('오피스 PoC 누구야?');
    expect(result.roles).toContain('POC');
  });

  test('QA 역할 파싱', () => {
    const result = parseOrgQuery('어시스턴트 QA');
    expect(result.roles).toContain('QA');
  });

  test('역할 없는 경우', () => {
    const result = parseOrgQuery('김철수 내선번호');
    expect(result.role).toBeNull();
    expect(result.roles).toHaveLength(0);
  });
});

// ========== parseStatus ==========
describe('parseStatus', () => {
  test('출근 상태', () => {
    expect(parseStatus('출근').type).toBe('working');
    expect(parseStatus('근무중').type).toBe('working');
    expect(parseStatus('재실').type).toBe('working');
    expect(parseStatus('출근').icon).toBe('🟢');
  });

  test('퇴근 상태', () => {
    expect(parseStatus('퇴근').type).toBe('left');
    expect(parseStatus('업무종료').type).toBe('left');
    expect(parseStatus('퇴근').icon).toBe('🔵');
  });

  test('연차 상태', () => {
    expect(parseStatus('연차').type).toBe('leave');
    expect(parseStatus('휴가').type).toBe('leave');
    expect(parseStatus('연차').icon).toBe('🟡');
  });

  test('휴직 상태', () => {
    expect(parseStatus('휴직').type).toBe('absent');
    expect(parseStatus('휴직').icon).toBe('🟠');
  });

  test('병가 상태', () => {
    expect(parseStatus('병가').type).toBe('sick');
    expect(parseStatus('병가').icon).toBe('🔴');
  });

  test('출장 상태', () => {
    expect(parseStatus('출장').type).toBe('trip');
    expect(parseStatus('출장').icon).toBe('🟣');
  });

  test('외근 상태', () => {
    expect(parseStatus('외근').type).toBe('outside');
    expect(parseStatus('외근').icon).toBe('🟤');
  });

  test('재택 상태', () => {
    expect(parseStatus('재택').type).toBe('remote');
    expect(parseStatus('재택근무').type).toBe('remote');
    expect(parseStatus('재택').icon).toBe('🏠');
  });

  test('반차 상태', () => {
    expect(parseStatus('반차').type).toBe('halfday');
    expect(parseStatus('오전반차').type).toBe('halfday');
  });

  test('알 수 없는 상태', () => {
    expect(parseStatus('기타상태').type).toBe('other');
    expect(parseStatus('기타상태').text).toBe('기타상태');
  });

  test('빈 상태', () => {
    expect(parseStatus('').type).toBe('unknown');
    expect(parseStatus(null).type).toBe('unknown');
    expect(parseStatus(undefined).type).toBe('unknown');
  });
});

// ========== QUERY_PATTERNS ==========
describe('QUERY_PATTERNS', () => {
  test('Yes/No 패턴', () => {
    expect(QUERY_PATTERNS.yesNo.test('출근했어?')).toBe(true);
    expect(QUERY_PATTERNS.yesNo.test('팀장이야?')).toBe(true);
    expect(QUERY_PATTERNS.yesNo.test('퇴근했나요?')).toBe(true);
    expect(QUERY_PATTERNS.yesNo.test('휴가중이에요?')).toBe(true);
  });

  test('출근 패턴', () => {
    expect(QUERY_PATTERNS.checkIn.test('출근했어?')).toBe(true);
    expect(QUERY_PATTERNS.checkIn.test('출근 중이야?')).toBe(true);
    expect(QUERY_PATTERNS.checkIn.test('나왔어?')).toBe(true);
    // v4.3.1: 회사/사무실/자리 패턴
    expect(QUERY_PATTERNS.checkIn.test('회사 계셔?')).toBe(true);
    expect(QUERY_PATTERNS.checkIn.test('회사에 있어?')).toBe(true);
    expect(QUERY_PATTERNS.checkIn.test('사무실 계셔?')).toBe(true);
    expect(QUERY_PATTERNS.checkIn.test('자리에 있어?')).toBe(true);
  });

  test('퇴근 패턴', () => {
    expect(QUERY_PATTERNS.checkOut.test('퇴근했어?')).toBe(true);
    expect(QUERY_PATTERNS.checkOut.test('갔어?')).toBe(true);
  });

  test('연차 패턴', () => {
    expect(QUERY_PATTERNS.leave.test('연차야?')).toBe(true);
    expect(QUERY_PATTERNS.leave.test('휴가중이야?')).toBe(true);
    expect(QUERY_PATTERNS.leave.test('쉬어?')).toBe(true);
  });

  test('메일 패턴', () => {
    expect(QUERY_PATTERNS.email.test('메일 뭐야?')).toBe(true);
    expect(QUERY_PATTERNS.email.test('이메일 알려줘')).toBe(true);
  });

  test('전화 패턴', () => {
    expect(QUERY_PATTERNS.phone.test('내선번호')).toBe(true);
    expect(QUERY_PATTERNS.phone.test('전화번호')).toBe(true);
  });

  test('휴대폰 패턴', () => {
    expect(QUERY_PATTERNS.mobile.test('핸드폰 번호')).toBe(true);
    expect(QUERY_PATTERNS.mobile.test('휴대폰')).toBe(true);
    expect(QUERY_PATTERNS.mobile.test('연락처')).toBe(true);
  });

  test('팀 패턴', () => {
    expect(QUERY_PATTERNS.team.test('어느 팀이야?')).toBe(true);
    expect(QUERY_PATTERNS.team.test('소속이 어디야?')).toBe(true);
  });

  test('담당 패턴', () => {
    expect(QUERY_PATTERNS.duty.test('뭐 담당해?')).toBe(true);
    expect(QUERY_PATTERNS.duty.test('업무가 뭐야?')).toBe(true);
    expect(QUERY_PATTERNS.duty.test('하는 일이 뭐야?')).toBe(true);
  });

  test('직책 패턴', () => {
    expect(QUERY_PATTERNS.position.test('직책이 뭐야?')).toBe(true);
    expect(QUERY_PATTERNS.position.test('직급이 뭐야?')).toBe(true);
  });

  test('누구 패턴', () => {
    expect(QUERY_PATTERNS.who.test('누구야?')).toBe(true);
    expect(QUERY_PATTERNS.who.test('PO 누구야?')).toBe(true);
  });
});

// ========== formatOrgSearchResult ==========
describe('formatOrgSearchResult', () => {
  const mockEmployee = {
    name: '김철수',
    deptName: '개발팀',
    position: '선임',
    office: '팀장',
    duty: '백엔드 개발',
    phone: '1234',
    mobile: '010-1234-5678',
    email: 'kim@company.com',
    status: '출근',
  };

  // 빈 결과 테스트
  describe('빈 결과', () => {
    test('검색 결과 없음', () => {
      const result = formatOrgSearchResult([], '김철수');
      expect(result).toContain('검색 결과가 없습니다');
    });

    test('null 결과', () => {
      const result = formatOrgSearchResult(null, '김철수');
      expect(result).toContain('검색 결과가 없습니다');
    });

    test('역할 힌트 표시', () => {
      const result = formatOrgSearchResult([], 'PO 누구야?', { role: 'PO' });
      expect(result).toContain('힌트');
      expect(result).toContain('PO');
    });
  });

  // Yes/No 질문 테스트
  describe('Yes/No 질문', () => {
    test('출근 여부 - 출근 중', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 출근했어?');
      expect(result).toContain('네');
      expect(result).toContain('출근 중');
    });

    test('출근 여부 - 연차', () => {
      const empOnLeave = { ...mockEmployee, status: '연차' };
      const result = formatOrgSearchResult([empOnLeave], '김철수 출근했어?');
      expect(result).toContain('아니오');
      expect(result).toContain('연차');
    });

    test('퇴근 여부 - 퇴근', () => {
      const empLeft = { ...mockEmployee, status: '퇴근' };
      const result = formatOrgSearchResult([empLeft], '김철수 퇴근했어?');
      expect(result).toContain('네');
      expect(result).toContain('퇴근');
    });

    test('퇴근 여부 - 출근 중', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 퇴근했어?');
      expect(result).toContain('아니오');
      expect(result).toContain('출근 중');
    });

    test('휴가 여부 - 연차 중', () => {
      const empOnLeave = { ...mockEmployee, status: '연차' };
      const result = formatOrgSearchResult([empOnLeave], '김철수 휴가야?');
      expect(result).toContain('네');
      expect(result).toContain('연차');
    });

    test('직책 여부 - 맞음', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 팀장이야?', { role: '팀장' });
      expect(result).toContain('네');
      expect(result).toContain('팀장');
    });

    test('직책 여부 - 아님', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 파트장이야?', { role: '파트장' });
      expect(result).toContain('아니오');
      expect(result).toContain('파트장이 아닙니다');
    });
  });

  // 직접 답변 테스트
  describe('직접 답변', () => {
    test('메일 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 메일 뭐야?');
      expect(result).toContain('kim@company.com');
      expect(result).toContain('입니다');
    });

    test('메일 없음', () => {
      const empNoEmail = { ...mockEmployee, email: '' };
      const result = formatOrgSearchResult([empNoEmail], '김철수 메일 뭐야?');
      expect(result).toContain('메일 정보가 없습니다');
    });

    test('전화번호 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 내선번호');
      expect(result).toContain('1234');
    });

    test('전화번호 없음', () => {
      const empNoPhone = { ...mockEmployee, phone: '' };
      const result = formatOrgSearchResult([empNoPhone], '김철수 전화번호');
      expect(result).toContain('내선 정보가 없습니다');
    });

    test('휴대폰 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 핸드폰 번호');
      expect(result).toContain('010-1234-5678');
    });

    test('휴대폰 없으면 내선 표시', () => {
      const empNoMobile = { ...mockEmployee, mobile: '' };
      const result = formatOrgSearchResult([empNoMobile], '김철수 휴대폰');
      expect(result).toContain('휴대폰은 없고');
      expect(result).toContain('1234');
    });

    test('연락처 전부 없음', () => {
      const empNoContact = { ...mockEmployee, mobile: '', phone: '' };
      const result = formatOrgSearchResult([empNoContact], '김철수 연락처');
      expect(result).toContain('연락처 정보가 없습니다');
    });

    test('팀 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 어느 팀이야?');
      expect(result).toContain('개발팀');
      expect(result).toContain('소속');
    });

    test('담당업무 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 뭐 담당해?');
      expect(result).toContain('백엔드 개발');
      expect(result).toContain('담당');
    });

    test('담당업무 없음', () => {
      const empNoDuty = { ...mockEmployee, duty: '' };
      const result = formatOrgSearchResult([empNoDuty], '김철수 업무가 뭐야?');
      expect(result).toContain('담당업무 정보가 없습니다');
    });

    test('직책 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 직책이 뭐야?');
      expect(result).toContain('팀장');
    });

    test('직책 없음', () => {
      const empNoOffice = { ...mockEmployee, office: '' };
      const result = formatOrgSearchResult([empNoOffice], '김철수 직책이 뭐야?');
      expect(result).toContain('직책 정보가 없습니다');
    });

    test('누구 질문 - 1명', () => {
      const result = formatOrgSearchResult([mockEmployee], 'PO 누구야?');
      expect(result).toContain('김철수');
    });

    test('누구 질문 - 여러명', () => {
      const employees = [
        { ...mockEmployee, name: '김철수' },
        { ...mockEmployee, name: '홍길동' },
        { ...mockEmployee, name: '박지혜' },
      ];
      const result = formatOrgSearchResult(employees, 'PO 누구야?');
      expect(result).toContain('김철수');
      expect(result).toContain('홍길동');
      expect(result).toContain('박지혜');
    });

    test('누구 질문 - 5명 초과', () => {
      const employees = Array(7).fill(null).map((_, i) => ({
        ...mockEmployee,
        name: `직원${i + 1}`,
      }));
      const result = formatOrgSearchResult(employees, 'PO 누구야?');
      expect(result).toContain('외 2명');
    });

    test('근무 상태 질문', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 근무 상태 뭐야?');
      expect(result).toContain('출근 중');
    });

    // v4.3.1: 동명이인 상태 질문
    test('동명이인 출근 질문', () => {
      const employees = [
        { ...mockEmployee, name: '최준성', deptName: '개발팀', status: '출근' },
        { ...mockEmployee, name: '박준성', deptName: '기획팀', status: '연차' },
        { ...mockEmployee, name: '배준성', deptName: '디자인팀', status: '퇴근' },
      ];
      const result = formatOrgSearchResult(employees, '준성님 출근했어?');
      expect(result).toContain('3명 있습니다');
      expect(result).toContain('최준성');
      expect(result).toContain('박준성');
      expect(result).toContain('🟢');  // 출근
      expect(result).toContain('🟡');  // 연차
      expect(result).toContain('🔵');  // 퇴근
    });

    test('동명이인 5명 초과', () => {
      const employees = Array(7).fill(null).map((_, i) => ({
        ...mockEmployee,
        name: `준성${i + 1}`,
        deptName: `팀${i + 1}`,
        status: '출근',
      }));
      const result = formatOrgSearchResult(employees, '준성님 출근했어?');
      expect(result).toContain('7명 있습니다');
      expect(result).toContain('외 2명');
    });
  });

  // 직원 카드 테스트
  describe('직원 카드', () => {
    test('기본 정보 표시', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수');
      expect(result).toContain('검색 결과');
      expect(result).toContain('1명');
      expect(result).toContain('김철수');
      expect(result).toContain('개발팀');
    });

    test('position "님" 제외', () => {
      const empBadPos = { ...mockEmployee, position: '님' };
      const result = formatOrgSearchResult([empBadPos], '김철수');
      expect(result).not.toContain('/ 님');
    });

    test('전화번호 강조 (전화 질문시)', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 전화번호');
      expect(result).toContain('*1234*');
    });

    test('상태 아이콘 표시', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수');
      expect(result).toContain('🟢');
    });

    test('10명 초과시 생략', () => {
      const employees = Array(15).fill(null).map((_, i) => ({
        ...mockEmployee,
        name: `직원${i + 1}`,
      }));
      const result = formatOrgSearchResult(employees, 'PO');
      expect(result).toContain('외 5명');
      expect(result).toContain('직원1');
      expect(result).toContain('직원10');
      expect(result).not.toContain('직원11');
    });

    // v4.3.1: 구분선 표시 조건
    test('답변 있으면 구분선 표시', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수 출근했어?');
      expect(result).toContain('───');
      expect(result).toContain('네');
    });

    test('답변 없으면 구분선 없음', () => {
      const result = formatOrgSearchResult([mockEmployee], '김철수');
      expect(result).not.toContain('───');
      expect(result).toContain('검색 결과');
    });

    test('회사 계셔? 질문 응답', () => {
      const result = formatOrgSearchResult([mockEmployee], '상태님 회사 계셔?');
      expect(result).toContain('네');
      expect(result).toContain('출근 중');
    });
  });
});
