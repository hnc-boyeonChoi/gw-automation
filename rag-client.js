/**
 * rag-client.js - RAG API 클라이언트 (v4.3.2)
 * 테스트 가능한 순수 함수들
 */

// ========== 설정 ==========
const DEFAULT_RAG_URL = 'http://172.19.0.129:8501';

// ========== 순수 함수 ==========

/**
 * 출처 버튼 포맷팅 (최대 5개, URL 있는 것만)
 */
function formatSourceButtons(sources) {
  if (!sources || !Array.isArray(sources)) return [];

  return sources
    .filter(s => s && s.url)
    .slice(0, 5)
    .map(s => ({
      text: (s.title || '문서 보기').substring(0, 25),
      onClick: {
        openLink: { url: s.url }
      }
    }));
}

/**
 * 가이드 링크 변환
 * 'XXX 가이드'를 참조/참고 → 클릭 가능한 링크로 변환
 */
function processGuideLinks(answer, sources) {
  if (!answer) return '';
  if (!sources || sources.length === 0) return answer;

  const firstSource = sources[0];
  if (!firstSource || !firstSource.url) return answer;

  let processed = answer;

  // 패턴: 'XXX 가이드'를 참조/참고 → 클릭 가능한 링크로
  processed = processed.replace(
    /'[^']+\s*가이드'를?\s*(참조|참고)/g,
    `<a href="${firstSource.url}">가이드 링크</a>를 참고`
  );

  // {{가이드 링크}} 플레이스홀더도 처리
  processed = processed.replace(
    /\{\{가이드 링크\}\}/g,
    `<a href="${firstSource.url}">가이드 링크</a>`
  );

  return processed;
}

/**
 * RAG 카드 JSON 생성
 */
function buildRagCard(title, answer, sources) {
  const sourceButtons = formatSourceButtons(sources);

  const card = {
    cardsV2: [{
      cardId: 'ragCard',
      card: {
        header: {
          title: title,
          subtitle: `v4.1 온보딩 가이드 · 출처 ${sources?.length || 0}개`
        },
        sections: [
          {
            widgets: [{
              textParagraph: { text: answer || '' }
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

  return card;
}

/**
 * RAG 응답 유효성 검사
 */
function validateRagResponse(data) {
  if (!data) {
    return { valid: false, error: '응답 데이터 없음' };
  }
  if (typeof data.answer !== 'string') {
    return { valid: false, error: '답변 형식 오류' };
  }
  return { valid: true, error: null };
}

/**
 * RAG 에러 응답 생성
 */
function createErrorResponse(message) {
  return {
    answer: `❌ RAG 서버 연결 실패: ${message}`,
    sources: []
  };
}

/**
 * RAG API 요청 본문 생성
 */
function buildRagRequestBody(question, conversationHistory = []) {
  return {
    question: question,
    conversation_history: conversationHistory
  };
}

// ========== API 호출 (테스트시 fetch 주입 가능) ==========

/**
 * RAG API 질의
 * @param {string} question - 질문
 * @param {Array} conversationHistory - 대화 히스토리
 * @param {Object} options - 옵션 { fetchFn, ragUrl, logger }
 */
async function askRag(question, conversationHistory = [], options = {}) {
  const {
    fetchFn = fetch,
    ragUrl = DEFAULT_RAG_URL,
    logger = console.log
  } = options;

  try {
    logger(`[RAG] 질문: ${question}, 히스토리: ${conversationHistory.length}개`);

    const response = await fetchFn(`${ragUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRagRequestBody(question, conversationHistory)),
    });

    if (!response.ok) {
      throw new Error(`RAG API 응답 에러: ${response.status}`);
    }

    const data = await response.json();
    const validation = validateRagResponse(data);

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    logger(`[RAG] 답변 수신 완료, 출처: ${data.sources?.length || 0}개`);

    return {
      answer: data.answer,
      sources: data.sources || []
    };
  } catch (error) {
    logger(`[RAG] 에러: ${error.message}`);
    return createErrorResponse(error.message);
  }
}

// ========== 모듈 내보내기 ==========
module.exports = {
  // 설정
  DEFAULT_RAG_URL,

  // 순수 함수
  formatSourceButtons,
  processGuideLinks,
  buildRagCard,
  validateRagResponse,
  createErrorResponse,
  buildRagRequestBody,

  // API 호출
  askRag,
};
