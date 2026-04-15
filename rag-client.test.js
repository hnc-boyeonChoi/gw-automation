/**
 * rag-client.test.js - RAG 클라이언트 테스트
 */

const {
  formatSourceButtons,
  processGuideLinks,
  buildRagCard,
  validateRagResponse,
  createErrorResponse,
  buildRagRequestBody,
  askRag,
  DEFAULT_RAG_URL,
} = require('./rag-client');

// ========== formatSourceButtons 테스트 ==========
describe('formatSourceButtons', () => {
  test('빈 배열 처리', () => {
    expect(formatSourceButtons([])).toEqual([]);
  });

  test('null/undefined 처리', () => {
    expect(formatSourceButtons(null)).toEqual([]);
    expect(formatSourceButtons(undefined)).toEqual([]);
  });

  test('URL 없는 항목 필터링', () => {
    const sources = [
      { title: '문서1', url: 'http://example.com/1' },
      { title: '문서2' },  // URL 없음
      { title: '문서3', url: 'http://example.com/3' },
    ];
    const result = formatSourceButtons(sources);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('문서1');
    expect(result[1].text).toBe('문서3');
  });

  test('최대 5개 제한', () => {
    const sources = Array(10).fill(null).map((_, i) => ({
      title: `문서${i}`,
      url: `http://example.com/${i}`
    }));
    const result = formatSourceButtons(sources);
    expect(result).toHaveLength(5);
  });

  test('긴 제목 25자 제한', () => {
    const sources = [{
      title: '아주 긴 문서 제목입니다 이것은 25자를 초과합니다',
      url: 'http://example.com'
    }];
    const result = formatSourceButtons(sources);
    expect(result[0].text.length).toBeLessThanOrEqual(25);
  });

  test('제목 없으면 기본값 사용', () => {
    const sources = [{ url: 'http://example.com' }];
    const result = formatSourceButtons(sources);
    expect(result[0].text).toBe('문서 보기');
  });

  test('onClick 구조 확인', () => {
    const sources = [{ title: 'Test', url: 'http://example.com' }];
    const result = formatSourceButtons(sources);
    expect(result[0].onClick).toEqual({
      openLink: { url: 'http://example.com' }
    });
  });
});

// ========== processGuideLinks 테스트 ==========
describe('processGuideLinks', () => {
  const mockSources = [{ url: 'http://guide.example.com' }];

  test('빈 답변 처리', () => {
    expect(processGuideLinks('', mockSources)).toBe('');
    expect(processGuideLinks(null, mockSources)).toBe('');
  });

  test('출처 없으면 원본 반환', () => {
    const answer = "'SSL-VPN 가이드'를 참조하세요.";
    expect(processGuideLinks(answer, [])).toBe(answer);
    expect(processGuideLinks(answer, null)).toBe(answer);
  });

  test('URL 없는 출처', () => {
    const answer = "'가이드'를 참조";
    expect(processGuideLinks(answer, [{ title: 'test' }])).toBe(answer);
  });

  test("'XXX 가이드'를 참조 → 링크 변환", () => {
    const answer = "'SSL-VPN 사용자 가이드'를 참조하세요.";
    const result = processGuideLinks(answer, mockSources);
    expect(result).toContain('<a href="http://guide.example.com">');
    expect(result).toContain('가이드 링크');
    expect(result).not.toContain("'SSL-VPN");
  });

  test("'XXX 가이드'를 참고 → 링크 변환", () => {
    const answer = "'연차 신청 가이드'를 참고해주세요.";
    const result = processGuideLinks(answer, mockSources);
    expect(result).toContain('<a href="http://guide.example.com">');
  });

  test('{{가이드 링크}} 플레이스홀더 변환', () => {
    const answer = '자세한 내용은 {{가이드 링크}}에서 확인하세요.';
    const result = processGuideLinks(answer, mockSources);
    expect(result).toContain('<a href="http://guide.example.com">가이드 링크</a>');
    expect(result).not.toContain('{{');
  });

  test('변환 대상 없으면 원본 유지', () => {
    const answer = '일반적인 답변입니다.';
    const result = processGuideLinks(answer, mockSources);
    expect(result).toBe(answer);
  });
});

// ========== buildRagCard 테스트 ==========
describe('buildRagCard', () => {
  test('기본 카드 구조', () => {
    const card = buildRagCard('제목', '답변 내용', []);
    expect(card.cardsV2).toHaveLength(1);
    expect(card.cardsV2[0].cardId).toBe('ragCard');
    expect(card.cardsV2[0].card.header.title).toBe('제목');
  });

  test('답변 표시', () => {
    const card = buildRagCard('제목', '테스트 답변', []);
    const textWidget = card.cardsV2[0].card.sections[0].widgets[0];
    expect(textWidget.textParagraph.text).toBe('테스트 답변');
  });

  test('출처 개수 subtitle 표시', () => {
    const sources = [{ url: 'http://a.com' }, { url: 'http://b.com' }];
    const card = buildRagCard('제목', '답변', sources);
    expect(card.cardsV2[0].card.header.subtitle).toContain('출처 2개');
  });

  test('출처 버튼 섹션 추가', () => {
    const sources = [{ title: '문서1', url: 'http://example.com' }];
    const card = buildRagCard('제목', '답변', sources);
    expect(card.cardsV2[0].card.sections).toHaveLength(2);
    expect(card.cardsV2[0].card.sections[1].header).toBe('📎 참고 문서');
  });

  test('출처 없으면 버튼 섹션 없음', () => {
    const card = buildRagCard('제목', '답변', []);
    expect(card.cardsV2[0].card.sections).toHaveLength(1);
  });

  test('null 답변 처리', () => {
    const card = buildRagCard('제목', null, []);
    const textWidget = card.cardsV2[0].card.sections[0].widgets[0];
    expect(textWidget.textParagraph.text).toBe('');
  });

  test('null 출처 처리', () => {
    const card = buildRagCard('제목', '답변', null);
    expect(card.cardsV2[0].card.header.subtitle).toContain('출처 0개');
  });
});

// ========== validateRagResponse 테스트 ==========
describe('validateRagResponse', () => {
  test('유효한 응답', () => {
    const result = validateRagResponse({ answer: '답변', sources: [] });
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  test('null 응답', () => {
    const result = validateRagResponse(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('응답 데이터 없음');
  });

  test('답변 없음', () => {
    const result = validateRagResponse({ sources: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('답변 형식 오류');
  });

  test('답변이 문자열 아님', () => {
    const result = validateRagResponse({ answer: 123 });
    expect(result.valid).toBe(false);
  });
});

// ========== createErrorResponse 테스트 ==========
describe('createErrorResponse', () => {
  test('에러 응답 생성', () => {
    const result = createErrorResponse('연결 실패');
    expect(result.answer).toContain('❌ RAG 서버 연결 실패');
    expect(result.answer).toContain('연결 실패');
    expect(result.sources).toEqual([]);
  });
});

// ========== buildRagRequestBody 테스트 ==========
describe('buildRagRequestBody', () => {
  test('기본 요청', () => {
    const body = buildRagRequestBody('질문');
    expect(body.question).toBe('질문');
    expect(body.conversation_history).toEqual([]);
  });

  test('히스토리 포함', () => {
    const history = [{ role: 'user', content: '이전 질문' }];
    const body = buildRagRequestBody('새 질문', history);
    expect(body.conversation_history).toEqual(history);
  });
});

// ========== askRag 테스트 ==========
describe('askRag', () => {
  const mockLogger = jest.fn();

  beforeEach(() => {
    mockLogger.mockClear();
  });

  test('성공적인 응답', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        answer: '테스트 답변',
        sources: [{ title: '출처1', url: 'http://example.com' }]
      })
    });

    const result = await askRag('테스트 질문', [], {
      fetchFn: mockFetch,
      logger: mockLogger
    });

    expect(result.answer).toBe('테스트 답변');
    expect(result.sources).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/ask'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('HTTP 에러 처리', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    const result = await askRag('질문', [], {
      fetchFn: mockFetch,
      logger: mockLogger
    });

    expect(result.answer).toContain('❌ RAG 서버 연결 실패');
    expect(result.answer).toContain('500');
  });

  test('네트워크 에러 처리', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network Error'));

    const result = await askRag('질문', [], {
      fetchFn: mockFetch,
      logger: mockLogger
    });

    expect(result.answer).toContain('Network Error');
    expect(result.sources).toEqual([]);
  });

  test('유효하지 않은 응답 처리', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invalid: 'data' })
    });

    const result = await askRag('질문', [], {
      fetchFn: mockFetch,
      logger: mockLogger
    });

    expect(result.answer).toContain('❌');
  });

  test('커스텀 RAG URL 사용', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ answer: 'ok', sources: [] })
    });

    await askRag('질문', [], {
      fetchFn: mockFetch,
      ragUrl: 'http://custom.server:9000',
      logger: mockLogger
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom.server:9000/ask',
      expect.any(Object)
    );
  });

  test('대화 히스토리 전송', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ answer: 'ok', sources: [] })
    });

    const history = [{ role: 'user', content: '이전' }];
    await askRag('새 질문', history, {
      fetchFn: mockFetch,
      logger: mockLogger
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.conversation_history).toEqual(history);
  });

  test('기본 URL 사용', () => {
    expect(DEFAULT_RAG_URL).toBe('http://172.19.0.129:8501');
  });
});
