/**
 * GW Automation - Google Chat Bot (Pub/Sub 버전)
 */

// =====================
// 설정값
// =====================
const ENCRYPTION_KEY = '2026AITech!@34';
const WEB_APP_KEY = '2026proTech!@34';

const PUBSUB_CONFIG = {
  PROJECT_ID: 'hc-prd-axtech-bot',
  TOPIC_NAME: 'gw-automation',
  URL: 'https://pubsub.googleapis.com/v1',
};

// =====================
// OpenAI 설정
// =====================
const OPENAI_CONFIG = {
  MODEL: 'gpt-4o-mini',  // 빠르고 저렴한 모델
  MAX_TOKENS: 150,
};

// =====================
// Pub/Sub 발행
// =====================
function publishToPubSub(message) {
  const topicPath = `projects/${PUBSUB_CONFIG.PROJECT_ID}/topics/${PUBSUB_CONFIG.TOPIC_NAME}`;
  const url = `${PUBSUB_CONFIG.URL}/${topicPath}:publish`;

  const payload = {
    messages: [{
      data: Utilities.base64Encode(JSON.stringify(message)),
    }],
  };

  const accessToken = getServiceAccountTokenForPubSub();

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + accessToken,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());

  if (response.getResponseCode() !== 200) {
    console.error('Pub/Sub 발행 실패:', result);
    throw new Error('Pub/Sub 발행 실패: ' + JSON.stringify(result));
  }

  console.log('Pub/Sub 발행 성공:', result);
  return result;
}

// =====================
// Pub/Sub용 서비스 계정 토큰
// =====================
function getServiceAccountTokenForPubSub() {
  const props = getProps();
  const saJson = props.getProperty('SERVICE_ACCOUNT_JSON');

  if (!saJson) {
    throw new Error('SERVICE_ACCOUNT_JSON이 설정되지 않았습니다.');
  }

  const sa = JSON.parse(saJson);
  const privateKey = fixPrivateKey(sa.private_key);

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/pubsub',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const claimSetB64 = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  const signatureInput = headerB64 + '.' + claimSetB64;

  const signature = Utilities.computeRsaSha256Signature(signatureInput, privateKey);
  const signatureB64 = Utilities.base64EncodeWebSafe(signature);

  const jwt = signatureInput + '.' + signatureB64;

  const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  const tokenData = JSON.parse(tokenResponse.getContentText());

  if (tokenData.error) {
    throw new Error(`토큰 발급 실패: ${tokenData.error_description || tokenData.error}`);
  }

  return tokenData.access_token;
}

// =====================
// PEM 형식 복원 (줄바꿈 추가)
// =====================
function fixPrivateKey(key) {
  if (key.includes('\n')) return key;

  const beginMarker = '-----BEGIN PRIVATE KEY-----';
  const endMarker = '-----END PRIVATE KEY-----';

  let base64 = key
    .replace(beginMarker, '')
    .replace(endMarker, '')
    .trim();

  const lines = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.substring(i, i + 64));
  }

  return beginMarker + '\n' + lines.join('\n') + '\n' + endMarker + '\n';
}

// =====================
// 암호화 / 복호화
// =====================
function encrypt(text) {
  const key = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    ENCRYPTION_KEY,
    Utilities.Charset.UTF_8
  );
  const keyBytes = key.slice(0, 16);
  const textBytes = Utilities.newBlob(text).getBytes();
  const encrypted = Utilities.base64Encode(
    textBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length])
  );
  return encrypted;
}

function decrypt(encrypted) {
  const key = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    ENCRYPTION_KEY,
    Utilities.Charset.UTF_8
  );
  const keyBytes = key.slice(0, 16);
  const encryptedBytes = Utilities.base64Decode(encrypted);
  const decrypted = encryptedBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
  return Utilities.newBlob(decrypted).getDataAsString();
}

// =====================
// 대화 기록 관리
// =====================
const CONVERSATION_CONFIG = {
  MAX_MESSAGES: 10,      // 최대 저장 메시지 수
  MAX_AGE_HOURS: 24,     // 최대 보관 시간 (시간)
};

function getConversationHistory(userId) {
  const props = getProps();
  const historyJson = props.getProperty(`conv_${userId}`) || '[]';
  try {
    let history = JSON.parse(historyJson);

    // 24시간 지난 메시지 필터링
    const maxAge = CONVERSATION_CONFIG.MAX_AGE_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    history = history.filter(msg => {
      const msgTime = new Date(msg.timestamp).getTime();
      return (now - msgTime) < maxAge;
    });

    return history;
  } catch (e) {
    console.error('대화 기록 파싱 실패:', e.message);
    return [];
  }
}

function addToConversationHistory(userId, role, content) {
  let history = getConversationHistory(userId);

  history.push({
    role: role,
    content: content,
    timestamp: new Date().toISOString()
  });

  // 최대 개수 유지
  if (history.length > CONVERSATION_CONFIG.MAX_MESSAGES) {
    history = history.slice(-CONVERSATION_CONFIG.MAX_MESSAGES);
  }

  const props = getProps();
  props.setProperty(`conv_${userId}`, JSON.stringify(history));
  console.log(`대화 기록 추가: ${userId}, role=${role}, 총 ${history.length}개`);
}

function clearConversationHistory(userId) {
  const props = getProps();
  props.deleteProperty(`conv_${userId}`);
  props.deleteProperty(`last_intent_${userId}`);
  console.log(`대화 기록 초기화: ${userId}`);
}

// 마지막 스크래핑 intent 저장/조회
function saveLastScrapingIntent(userId, intent) {
  const props = getProps();
  props.setProperty(`last_intent_${userId}`, intent);
}

function getLastScrapingIntent(userId) {
  const props = getProps();
  return props.getProperty(`last_intent_${userId}`);
}

// =====================
// OpenAI API 호출
// =====================
function callOpenAI(systemPrompt, userMessage) {
  const props = getProps();
  const apiKey = props.getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    console.error('OPENAI_API_KEY가 설정되지 않았습니다.');
    return null;
  }

  const payload = {
    model: OPENAI_CONFIG.MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: OPENAI_CONFIG.MAX_TOKENS,
    temperature: 0.1,  // 일관된 응답을 위해 낮은 temperature
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    const result = JSON.parse(response.getContentText());

    if (result.error) {
      console.error('OpenAI API 에러:', result.error);
      return null;
    }

    return result.choices[0].message.content.trim();
  } catch (e) {
    console.error('OpenAI 호출 실패:', e.message);
    return null;
  }
}

// 대화 히스토리 포함 OpenAI 호출
function callOpenAIWithHistory(userId, systemPrompt, userMessage) {
  const props = getProps();
  const apiKey = props.getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    console.error('OPENAI_API_KEY가 설정되지 않았습니다.');
    return null;
  }

  // 대화 히스토리 가져오기
  const history = getConversationHistory(userId);
  console.log(`대화 히스토리: ${history.length}개 메시지`);

  // 메시지 배열 구성: system + history + current
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  const payload = {
    model: OPENAI_CONFIG.MODEL,
    messages: messages,
    max_tokens: OPENAI_CONFIG.MAX_TOKENS,
    temperature: 0.1,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    const result = JSON.parse(response.getContentText());

    if (result.error) {
      console.error('OpenAI API 에러:', result.error);
      return null;
    }

    return result.choices[0].message.content.trim();
  } catch (e) {
    console.error('OpenAI 호출 실패:', e.message);
    return null;
  }
}

// =====================
// 빠른 패턴 매칭 (LLM 호출 전 - 비용 절감)
// =====================
const QUICK_PATTERNS = {
  team: /팀\s*(현황|상황)?|근태|출근|누가\s*(출근|휴가|외근)|우리\s*팀/i,
  leave: /연차|휴가|남은\s*(연차|휴가)|내\s*연차/i,
  approval: /결재|승인|미결/i,
  board: /게시판|공지|새\s*글/i,
  mail: /메일|이메일/i,
  note: /쪽지/i,
  budget: /예산|예실|비용/i,
  all: /전체\s*브리핑|모든\s*정보|오늘\s*현황|다\s*알려/i,
  login: /로그인|접속/i,
  greeting: /^(안녕|하이|헬로|ㅎㅇ|hi|hello)/i,
  help: /도움말|뭐\s*할\s*수\s*있|어떤\s*기능/i,
  clear: /잊어|초기화|리셋|대화\s*삭제/i,
  repeat: /^(다시|아까\s*그거|또\s*보여)$/i,
};

function quickPatternMatch(message) {
  const trimmed = message.trim();

  for (const [intent, pattern] of Object.entries(QUICK_PATTERNS)) {
    if (pattern.test(trimmed)) {
      console.log(`빠른 패턴 매칭: "${trimmed}" → ${intent}`);
      return { intent, confidence: 0.9, fromPattern: true };
    }
  }
  return null;
}

// =====================
// 의도 분류 (대화 맥락 포함)
// =====================
function classifyIntent(userId, userMessage) {
  // 1. 빠른 패턴 매칭 시도 (LLM 호출 스킵)
  const quickResult = quickPatternMatch(userMessage);
  if (quickResult) {
    return quickResult;
  }

  // 2. 패턴 매칭 실패 시 LLM 호출
  const systemPrompt = `당신은 그룹웨어 챗봇의 의도 분류기입니다.
사용자 메시지를 분석하여 아래 intent 중 하나를 JSON으로 반환하세요.

**핵심 규칙:**
1. 그룹웨어/업무와 관련 없는 일반 대화 → 반드시 unknown
2. 메시지에 구체적인 업무 주제(팀, 연차, 결재, 게시판 등)가 있으면 → 해당 intent
3. "다시 알려줘"가 있어도 업무 주제가 명확하면 → 해당 intent
4. repeat은 오직 "다시", "아까 그거"처럼 주제가 전혀 없을 때만

**unknown으로 분류해야 하는 경우:**
- 날씨, 시간, 개인적인 이야기 ("비가 와", "배고파", "오늘 뭐해?")
- 그룹웨어와 무관한 질문 ("맛집 추천해줘", "게임 뭐해?")
- 업무 키워드가 전혀 없는 잡담

**예시:**
- "팀 현황 다시 알려줘" → team
- "연차 다시 보여줘" → leave
- "다시 보여줘" → repeat
- "그리고 연차는?" → leave
- "오늘 비가 오잖아" → unknown (업무 무관)
- "점심 뭐 먹지?" → unknown (업무 무관)
- "안녕" → greeting

**가능한 intent:**
- team: 팀 현황, 팀원 근태, 누가 출근/휴가/건강검진
- leave: 내 연차, 남은 휴가, 연차 잔여
- approval: 결재, 전자결재, 승인할 문서
- board: 게시판, 공지사항, 새 글
- note: 쪽지
- mail: 메일, 이메일
- budget: 예산, 예실, 비용
- all: 전체 브리핑, 오늘 현황, 모든 정보
- login: 로그인, 접속
- greeting: 인사 (안녕, 하이)
- help: 도움말, 뭐 할 수 있어
- repeat: 주제 없이 "다시", "아까 그거"만 있을 때
- clear: 대화 기록 초기화 (잊어, 초기화, 리셋)
- unknown: 업무와 무관한 대화, 위에 해당하지 않는 경우

반드시 JSON 형식으로만 응답하세요:
{"intent": "unknown", "confidence": 0.95}`;

  const response = callOpenAIWithHistory(userId, systemPrompt, userMessage);

  if (!response) {
    return { intent: 'unknown', confidence: 0 };
  }

  try {
    // JSON 파싱 시도
    const parsed = JSON.parse(response);
    return parsed;
  } catch (e) {
    // JSON 파싱 실패 시 텍스트에서 intent 추출 시도
    console.error('JSON 파싱 실패:', response);
    return { intent: 'unknown', confidence: 0 };
  }
}

// =====================
// 자연어 메시지 처리 (대화 기록 포함)
// =====================
function handleNaturalLanguage(event, userMessage) {
  const userId = event.chat?.user?.name || event.user?.name;
  let spaceId = event.chat?.space?.name
    || event.space?.name
    || event.message?.space?.name
    || event.chat?.messagePayload?.space?.name;

  // spaceId가 없으면 저장된 값 사용
  if (!spaceId && userId) {
    const props = getProps();
    spaceId = props.getProperty(`space_${userId}`);
    console.log('저장된 spaceId 사용:', spaceId);
  }

  console.log('자연어 처리 시작:', userMessage);
  console.log('userId:', userId, 'spaceId:', spaceId);

  if (!userId || !spaceId) {
    console.error('userId 또는 spaceId를 찾을 수 없음');
    return reply('오류: 사용자 정보를 찾을 수 없어요. 다시 시도해주세요.');
  }

  // 사용자 메시지를 대화 기록에 저장
  addToConversationHistory(userId, 'user', userMessage);

  // 의도 분류 (대화 히스토리 포함)
  const result = classifyIntent(userId, userMessage);
  console.log('의도 분류 결과:', JSON.stringify(result));

  const intent = result.intent;
  const confidence = result.confidence || 0;

  // confidence가 낮으면 친절한 응답 + 메뉴 카드
  if (confidence < 0.7 && intent !== 'greeting' && intent !== 'help' && intent !== 'clear' && intent !== 'repeat') {
    return createUnknownResponseWithMenu(userMessage);
  }

  let response;

  switch (intent) {
    case 'greeting':
      response = '안녕하세요! 무엇을 도와드릴까요?\n\n' +
        '팀 현황, 연차, 결재, 게시판, 메일 등을 확인할 수 있어요.\n' +
        '예: "팀 현황 알려줘", "내 연차 얼마나 남았어?"';
      addToConversationHistory(userId, 'assistant', response);
      return reply(response);

    case 'help':
      response = '제가 할 수 있는 것들이에요:\n\n' +
        '👥 팀 현황 - "팀 현황 알려줘"\n' +
        '🏖️ 연차 - "내 연차 얼마나 남았어?"\n' +
        '📝 결재 - "결재할 문서 있어?"\n' +
        '📌 게시판 - "새 공지사항 있어?"\n' +
        '✉️ 쪽지 - "안 읽은 쪽지 있어?"\n' +
        '📧 메일 - "메일 확인해줘"\n' +
        '💰 예실 - "예산 현황 알려줘"\n' +
        '📊 전체 - "오늘 브리핑 해줘"';
      addToConversationHistory(userId, 'assistant', response);
      return reply(response);

    case 'clear':
      clearConversationHistory(userId);
      response = '대화 기록을 초기화했어요. 새로 시작할게요!';
      return reply(response);

    case 'repeat':
      // 마지막 스크래핑 요청 반복
      const lastIntent = getLastScrapingIntent(userId);
      if (lastIntent) {
        return triggerScrapeByIntent(userId, spaceId, lastIntent);
      } else {
        response = '이전에 요청한 내용이 없어요. 무엇을 알려드릴까요?';
        return reply(response);
      }

    case 'team':
    case 'leave':
    case 'approval':
    case 'board':
    case 'note':
    case 'mail':
    case 'budget':
    case 'all':
      // 마지막 스크래핑 intent 저장
      saveLastScrapingIntent(userId, intent);
      // 스크래핑 요청
      return triggerScrapeByIntent(userId, spaceId, intent);

    case 'login':
      return triggerLoginByIntent(userId, spaceId);

    case 'unknown':
    default:
      // 친절한 안내 메시지 + 메뉴 카드
      return createUnknownResponseWithMenu(userMessage);
  }
}

// unknown일 때 친절한 응답 + 메뉴 카드
function createUnknownResponseWithMenu(userMessage) {
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: {
            text: '그건 제가 도와드리기 어려워요 😅\n그룹웨어 관련 정보를 확인해보세요!',
            cardsV2: [{
              cardId: "menuCardUnknown",
              card: {
                header: {
                  title: "GW Automation",
                  subtitle: "그룹웨어 정보 조회"
                },
                sections: [{
                  widgets: [{
                    buttonList: {
                      buttons: [
                        { text: "👥 팀 현황", onClick: { action: { function: "triggerScrape", parameters: [{ key: "scrapeType", value: "team" }] } } },
                        { text: "🏖️ 연차", onClick: { action: { function: "triggerScrape", parameters: [{ key: "scrapeType", value: "leave" }] } } },
                        { text: "📝 결재", onClick: { action: { function: "triggerScrape", parameters: [{ key: "scrapeType", value: "approval" }] } } }
                      ]
                    }
                  }, {
                    buttonList: {
                      buttons: [
                        { text: "📌 게시판", onClick: { action: { function: "triggerScrape", parameters: [{ key: "scrapeType", value: "board" }] } } },
                        { text: "📧 메일", onClick: { action: { function: "triggerScrape", parameters: [{ key: "scrapeType", value: "mail" }] } } },
                        { text: "📊 전체 브리핑", onClick: { action: { function: "triggerScrape", parameters: [{ key: "scrapeType", value: "all" }] } } }
                      ]
                    }
                  }]
                }]
              }
            }]
          }
        }
      }
    }
  };
}

function triggerScrapeByIntent(userId, spaceId, scrapeType) {
  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);

  if (!encId) {
    return reply('먼저 로그인 정보를 등록해주세요!');
  }

  const username = decrypt(encId);

  const typeMessages = {
    team: '👥 팀 현황',
    approval: '📝 전자결재',
    leave: '🏖️ 연차 현황',
    board: '📌 게시판',
    note: '✉️ 쪽지',
    mail: '📧 메일',
    budget: '💰 예실현황',
    all: '📊 전체 브리핑'
  };
  const typeLabel = typeMessages[scrapeType] || scrapeType;

  try {
    publishToPubSub({
      action: 'scrape',
      username: username,
      userId: userId,
      spaceId: spaceId,
      scrapeType: scrapeType,
      timestamp: new Date().toISOString(),
    });

    console.log('자연어 → Pub/Sub 발행 완료:', scrapeType);
    return reply(`🔄 ${typeLabel} 조회 중이에요...`);
  } catch (e) {
    console.error('triggerScrapeByIntent 에러:', e.message);
    return reply('오류가 발생했어요: ' + e.message);
  }
}

function triggerLoginByIntent(userId, spaceId) {
  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);

  if (!encId) {
    return reply('먼저 로그인 정보를 등록해주세요!');
  }

  const username = decrypt(encId);

  try {
    publishToPubSub({
      action: 'login',
      username: username,
      userId: userId,
      spaceId: spaceId,
      timestamp: new Date().toISOString(),
    });

    return reply('🔄 로그인 진행 중이에요!\n📱 Okta Verify 앱에서 푸시 승인해주세요.');
  } catch (e) {
    return reply('오류가 발생했어요: ' + e.message);
  }
}

// =====================
// 유틸
// =====================
function reply(text) {
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: { text: text }
        }
      }
    }
  };
}

function getProps() {
  return PropertiesService.getScriptProperties();
}

// =====================
// 슬래시 명령어 처리
// =====================
function onAppCommand(event) {
  console.log('onAppCommand event:', JSON.stringify(event));

  const commandName = event.appCommandMetadata?.appCommandId || '';
  const userId = event.user?.name;
  const spaceId = event.space?.name;

  console.log('commandName:', commandName, 'userId:', userId, 'spaceId:', spaceId);

  // 설정 체크
  const props = getProps();
  const state = props.getProperty(`state_${userId}`) || 'NONE';

  if (state !== 'DONE' && commandName !== 'setup') {
    return reply('먼저 로그인 정보 설정이 필요해요! 아무 메시지나 보내서 설정해주세요.');
  }

  // 명령어별 처리
  switch (commandName) {
    case 'login':
      return handleLogin(userId, spaceId);
    case 'briefing':
      return handleScrape(userId, spaceId, 'all');
    case 'scrape_team':
      return handleScrape(userId, spaceId, 'team');
    case 'scrape_leave':
      return handleScrape(userId, spaceId, 'leave');
    case 'scrape_approval':
      return handleScrape(userId, spaceId, 'approval');
    case 'scrape_board':
      return handleScrape(userId, spaceId, 'board');
    case 'scrape_mail':
      return handleScrape(userId, spaceId, 'mail');
    default:
      return reply('알 수 없는 명령어입니다: ' + commandName);
  }
}

function handleLogin(userId, spaceId) {
  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);
  if (!encId) {
    return reply('저장된 로그인 정보가 없어요.');
  }

  const username = decrypt(encId);

  try {
    publishToPubSub({
      action: 'login',
      username: username,
      userId: userId,
      spaceId: spaceId,
      timestamp: new Date().toISOString(),
    });

    return reply(
      '🔄 로그인 진행 중이에요!\n' +
      '📱 Okta Verify 앱에서 푸시 승인해주세요.'
    );
  } catch (e) {
    return reply('오류가 발생했어요: ' + e.message);
  }
}

function handleScrape(userId, spaceId, scrapeType) {
  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);
  if (!encId) {
    return reply('저장된 로그인 정보가 없어요.');
  }

  const username = decrypt(encId);

  const typeMessages = {
    team: '👥 팀 현황',
    approval: '📝 전자결재',
    leave: '🏖️ 연차 현황',
    board: '📌 게시판',
    note: '✉️ 쪽지',
    mail: '📧 메일',
    budget: '💰 예실현황',
    all: '📊 전체 브리핑'
  };
  const typeLabel = typeMessages[scrapeType] || scrapeType;

  try {
    publishToPubSub({
      action: 'scrape',
      username: username,
      userId: userId,
      spaceId: spaceId,
      scrapeType: scrapeType,
      timestamp: new Date().toISOString(),
    });

    // 메시지 없이 처리 (Worker에서 결과 전송)
    return;  // 응답 없음
  } catch (e) {
    return reply('오류가 발생했어요: ' + e.message);
  }
}

// =====================
// 봇 추가됨 - 설정 다이얼로그 열기
// =====================
function onAddedToSpace(event) {
  console.log('onAddedToSpace event:', JSON.stringify(event));

  const userId = event.user.name;
  const spaceId = event.space.name;

  const props = getProps();
  props.setProperty('space_' + userId, spaceId);

  return {
    action: {
      navigations: [{
        pushCard: {
          header: {
            title: "GW Automation 설정",
            subtitle: "그룹웨어 로그인 정보를 입력해주세요"
          },
          sections: [{
            widgets: [
              {
                textInput: {
                  name: "username",
                  label: "아이디",
                  type: "SINGLE_LINE",
                  hintText: "한컴 그룹웨어 아이디 (Okta ID)"
                }
              },
              {
                textInput: {
                  name: "password",
                  label: "패스워드",
                  type: "SINGLE_LINE",
                  hintText: "패스워드 입력"
                }
              },
              {
                buttonList: {
                  buttons: [
                    {
                      text: "저장",
                      onClick: { action: { function: "saveCredentials" } }
                    }
                  ]
                }
              }
            ]
          }]
        }
      }]
    }
  };
}

// =====================
// 스페이스 퇴장 - 사용자 데이터 정리
// =====================
function onRemovedFromSpace(event) {
  console.log('봇이 스페이스에서 제거됨:', JSON.stringify(event));

  if (event.space && event.space.type === 'DM' && event.user) {
    const userId = event.user.name;
    const props = getProps();

    props.deleteProperty(`cred_id_${userId}`);
    props.deleteProperty(`cred_pw_${userId}`);
    props.deleteProperty(`space_${userId}`);
    props.deleteProperty(`state_${userId}`);
    props.deleteProperty(`mfa_status_${userId}`);

    console.log(`사용자 데이터 삭제 완료: ${userId}`);
  }
}

// =====================
// 메시지 수신
// =====================
function onMessage(event) {
  console.log('onMessage event:', JSON.stringify(event));

  const userId = event.chat.user.name;
  const props = getProps();
  const state = props.getProperty(`state_${userId}`) || 'NONE';

  // 사용자 메시지 텍스트 추출
  const userMessage = event.chat?.messagePayload?.message?.text
    || event.message?.text
    || event.message?.argumentText
    || '';

  console.log('사용자 메시지:', userMessage);

  if (state !== 'DONE') {
    return {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: {
              cardsV2: [{
                cardId: "setupCard",
                card: {
                  sections: [{
                    widgets: [{
                      textParagraph: {
                        text: "먼저 로그인 정보 설정이 필요해요!"
                      }
                    }, {
                      buttonList: {
                        buttons: [{
                          text: "설정하기",
                          onClick: {
                            action: {
                              function: "openSettingsDialog",
                              interaction: "OPEN_DIALOG"
                            }
                          }
                        }]
                      }
                    }]
                  }]
                }
              }]
            }
          }
        }
      }
    };
  }

  // 자연어 처리 시도
  if (userMessage && userMessage.trim().length > 0) {
    const nlResult = handleNaturalLanguage(event, userMessage.trim());
    if (nlResult) {
      return nlResult;  // 자연어로 처리 성공
    }
  }

  // 메뉴 카드 표시 (기본)
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: {
            cardsV2: [{
              cardId: "menuCard",
              card: {
                header: {
                  title: "GW Automation",
                  subtitle: "그룹웨어 정보 조회"
                },
                sections: [{
                  widgets: [{
                    buttonList: {
                      buttons: [
                        {
                          text: "📊 전체 브리핑",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "all" }]
                            }
                          }
                        }
                      ]
                    }
                  }, {
                    buttonList: {
                      buttons: [
                        {
                          text: "👥 팀 현황",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "team" }]
                            }
                          }
                        },
                        {
                          text: "📝 결재할 문서",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "approval" }]
                            }
                          }
                        },
                        {
                          text: "🏖️ 남은 연차",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "leave" }]
                            }
                          }
                        }
                      ]
                    }
                  }, {
                    buttonList: {
                      buttons: [
                        {
                          text: "📌 새 게시글",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "board" }]
                            }
                          }
                        },
                        {
                          text: "✉️ 쪽지",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "note" }]
                            }
                          }
                        },
                        {
                          text: "📧 메일",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "mail" }]
                            }
                          }
                        },
                        {
                          text: "💰 예실현황",
                          onClick: {
                            action: {
                              function: "triggerScrape",
                              parameters: [{ key: "scrapeType", value: "budget" }]
                            }
                          }
                        }
                      ]
                    }
                  }, {
                    buttonList: {
                      buttons: [
                        {
                          text: "🔐 Okta 로그인",
                          onClick: {
                            action: {
                              function: "triggerLogin"
                            }
                          }
                        },
                        {
                          text: "🔑 계정 등록",
                          onClick: {
                            action: {
                              function: "openSettingsDialog",
                              interaction: "OPEN_DIALOG"
                            }
                          }
                        }
                      ]
                    }
                  }]
                }]
              }
            }]
          }
        }
      }
    }
  };
}

// =====================
// 설정 Dialog
// =====================
function openSettingsDialog(event) {
  return {
    action: {
      navigations: [{
        pushCard: {
          header: {
            title: "GW Automation 설정",
            subtitle: "그룹웨어 로그인 정보"
          },
          sections: [{
            widgets: [
              {
                textInput: {
                  name: "username",
                  label: "아이디",
                  type: "SINGLE_LINE",
                  hintText: "한컴 그룹웨어 아이디 (Okta ID)"
                }
              },
              {
                textInput: {
                  name: "password",
                  label: "패스워드",
                  type: "SINGLE_LINE",
                  hintText: "패스워드 입력"
                }
              },
              {
                buttonList: {
                  buttons: [
                    {
                      text: "저장",
                      onClick: { action: { function: "saveCredentials" } }
                    },
                    {
                      text: "취소",
                      onClick: { action: { function: "cancelDialog" } }
                    }
                  ]
                }
              }
            ]
          }]
        }
      }]
    }
  };
}

// =====================
// Dialog 저장 처리
// =====================
function saveCredentials(event) {
  console.log('saveCredentials event:', JSON.stringify(event));

  const userId = event.chat.user.name;
  const spaceId = event.chat?.buttonClickedPayload?.space?.name
    || event.space?.name
    || event.chat?.space?.name;
  const formInputs = event.commonEventObject.formInputs;
  let username = formInputs.username.stringInputs.value[0].trim();
  const password = formInputs.password.stringInputs.value[0];

  // @ 있으면 앞부분만 추출 (예: boyeon.choi@hancom.com → boyeon.choi)
  if (username.includes('@')) {
    username = username.split('@')[0];
  }

  const props = getProps();
  props.setProperty(`cred_id_${userId}`, encrypt(username));
  props.setProperty(`cred_pw_${userId}`, encrypt(password));
  props.setProperty(`state_${userId}`, 'DONE');

  if (spaceId) {
    props.setProperty(`space_${userId}`, spaceId);
    console.log('spaceId 저장:', spaceId);
  }

  return {
    action: {
      navigations: [{ endNavigation: { action: "CLOSE_DIALOG" } }],
      notification: { text: "저장 완료! 이제 그룹웨어 정보를 가져올 수 있어요." }
    }
  };
}

// =====================
// Dialog 취소
// =====================
function cancelDialog(event) {
  return {
    action: {
      navigations: [{ endNavigation: { action: "CLOSE_DIALOG" } }],
      notification: { text: "취소됐어요." }
    }
  };
}

// =====================
// 로그인 요청 (Pub/Sub 발행) - 버튼용
// =====================
function triggerLogin(event) {
  console.log('triggerLogin event:', JSON.stringify(event));

  const userId = event.chat?.user?.name
    || event.user?.name
    || event.commonEventObject?.user?.name;
  const spaceId = event.chat?.buttonClickedPayload?.space?.name
    || event.space?.name
    || event.message?.space?.name;

  console.log('userId:', userId, 'spaceId:', spaceId);

  if (!userId || !spaceId) {
    console.error('userId 또는 spaceId를 찾을 수 없음:', JSON.stringify(event));
    return reply('이벤트 처리 실패: 사용자 정보를 찾을 수 없어요.');
  }

  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);
  if (!encId) {
    return reply('저장된 로그인 정보가 없어요.\n먼저 설정에서 아이디를 입력해주세요!');
  }

  const username = decrypt(encId);

  try {
    publishToPubSub({
      action: 'login',
      username: username,
      userId: userId,
      spaceId: spaceId,
      timestamp: new Date().toISOString(),
    });

    console.log('Pub/Sub 발행 완료 (login)');

    // 메시지 없음 - Worker에서 푸시 전송 후 알림
    return;
  } catch (e) {
    console.error('triggerLogin 에러:', e.message);
    return reply('오류가 발생했어요: ' + e.message);
  }
}

// =====================
// 스크래핑 요청 (Pub/Sub 발행)
// =====================
function triggerScrape(event) {
  console.log('triggerScrape event:', JSON.stringify(event));

  const userId = event.chat?.user?.name
    || event.user?.name
    || event.commonEventObject?.user?.name;
  const spaceId = event.chat?.buttonClickedPayload?.space?.name
    || event.space?.name
    || event.message?.space?.name;

  const parameters = event.commonEventObject?.parameters || {};
  const scrapeType = parameters.scrapeType || 'all';

  console.log('userId:', userId, 'spaceId:', spaceId, 'scrapeType:', scrapeType);

  if (!userId || !spaceId) {
    console.error('userId 또는 spaceId를 찾을 수 없음:', JSON.stringify(event));
    return reply('이벤트 처리 실패: 사용자 정보를 찾을 수 없어요.');
  }

  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);
  if (!encId) {
    return reply('저장된 로그인 정보가 없어요.\n먼저 설정에서 아이디를 입력해주세요!');
  }

  const username = decrypt(encId);

  const typeMessages = {
    team: '👥 팀 현황',
    approval: '📝 전자결재',
    leave: '🏖️ 연차 현황',
    board: '📌 게시판',
    note: '✉️ 쪽지',
    mail: '📧 메일',
    budget: '💰 예실현황',
    all: '📊 전체 브리핑'
  };
  const typeLabel = typeMessages[scrapeType] || scrapeType;

  try {
    publishToPubSub({
      action: 'scrape',
      username: username,
      userId: userId,
      spaceId: spaceId,
      scrapeType: scrapeType,
      timestamp: new Date().toISOString(),
    });

    console.log('Pub/Sub 발행 완료 (scrape):', scrapeType);

    // 메시지 없이 처리 (Worker에서 결과 전송)
    return;  // 응답 없음
  } catch (e) {
    console.error('triggerScrape 에러:', e.message);
    return reply('오류가 발생했어요: ' + e.message);
  }
}

// =====================
// 모닝브리핑 요청 (Pub/Sub 발행)
// =====================
function triggerMorningBriefing(event) {
  console.log('triggerMorningBriefing event:', JSON.stringify(event));

  const userId = event.chat?.user?.name
    || event.user?.name
    || event.commonEventObject?.user?.name;
  const spaceId = event.chat?.buttonClickedPayload?.space?.name
    || event.space?.name
    || event.message?.space?.name;

  console.log('userId:', userId, 'spaceId:', spaceId);

  if (!userId || !spaceId) {
    console.error('userId 또는 spaceId를 찾을 수 없음:', JSON.stringify(event));
    return reply('이벤트 처리 실패: 사용자 정보를 찾을 수 없어요.');
  }

  const props = getProps();
  const encId = props.getProperty(`cred_id_${userId}`);
  if (!encId) {
    return reply('저장된 로그인 정보가 없어요.\n먼저 설정에서 아이디를 입력해주세요!');
  }

  const username = decrypt(encId);

  try {
    publishToPubSub({
      action: 'morning_briefing',
      username: username,
      userId: userId,
      spaceId: spaceId,
      timestamp: new Date().toISOString(),
    });

    console.log('Pub/Sub 발행 완료 (morning_briefing)');

    return reply(
      '🔄 아침 브리핑 준비 중이에요!\n' +
      '📱 Okta Verify 앱에서 푸시 승인해주세요.\n\n' +
      '인증 완료 후 그룹웨어 현황을 알려드릴게요!'
    );
  } catch (e) {
    console.error('triggerMorningBriefing 에러:', e.message);
    return reply('오류가 발생했어요: ' + e.message);
  }
}

// =====================
// MFA 푸시 버튼 클릭 처리
// =====================
function triggerMfaPush(event) {
  const props = getProps();
  const userId = event.chat.user.name;

  props.setProperty(`mfa_status_${userId}`, 'APPROVED');
  props.setProperty(`mfa_approved_at_${userId}`, new Date().toISOString());

  return {
    action: {
      notification: {
        text: "확인! 푸시 알림이 곧 전송됩니다. Okta Verify 앱을 확인하세요."
      }
    }
  };
}

// =====================
// Chat API용 서비스 계정 토큰 발급
// =====================
function getServiceAccountToken() {
  const props = getProps();
  const saJson = props.getProperty('SERVICE_ACCOUNT_JSON');

  if (!saJson) {
    throw new Error('SERVICE_ACCOUNT_JSON이 설정되지 않았습니다.');
  }

  const sa = JSON.parse(saJson);
  const privateKey = fixPrivateKey(sa.private_key);

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/chat.bot',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const claimSetB64 = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  const signatureInput = headerB64 + '.' + claimSetB64;

  const signature = Utilities.computeRsaSha256Signature(signatureInput, privateKey);
  const signatureB64 = Utilities.base64EncodeWebSafe(signature);

  const jwt = signatureInput + '.' + signatureB64;

  const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  const tokenData = JSON.parse(tokenResponse.getContentText());

  if (tokenData.error) {
    throw new Error(`토큰 발급 실패: ${tokenData.error_description || tokenData.error}`);
  }

  return tokenData.access_token;
}

// =====================
// 등록된 모든 사용자 목록
// =====================
function getAllRegisteredUsers() {
  const props = getProps();
  const allKeys = props.getKeys();

  const users = allKeys
    .filter(k => k.startsWith('cred_id_'))
    .map(k => {
      const usId = k.replace('cred_id_', '');
      const spaceId = props.getProperty(`space_${usId}`);
      const username = decrypt(props.getProperty(`cred_id_${usId}`));
      return { userId: usId, spaceId, username };
    })
    .filter(u => u.spaceId);

  return users;
}

// =====================
// MFA 카드 전송 (서비스 계정으로 Chat API 호출)
// =====================
function sendMfaCard(spaceId, userId, username) {
  const message = {
    cardsV2: [{
      cardId: 'mfaCard',
      card: {
        header: {
          title: '☀️ 아침 브리핑',
          subtitle: '그룹웨어 현황을 가져올게요'
        },
        sections: [{
          widgets: [{
            textParagraph: {
              text: 'MFA 인증이 필요합니다.\n버튼을 누르면 Okta Verify 앱에 푸시 알림이 전송됩니다.'
            }
          }, {
            buttonList: {
              buttons: [{
                text: '📱 푸시 알림 받기',
                onClick: {
                  action: {
                    function: 'triggerMorningBriefing'
                  }
                }
              }]
            }
          }]
        }]
      }
    }]
  };

  const accessToken = getServiceAccountToken();

  const response = UrlFetchApp.fetch(`https://chat.googleapis.com/v1/${spaceId}/messages`, {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + accessToken },
    payload: JSON.stringify(message),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (result.error) {
    throw new Error(`카드 전송 실패: ${result.error.message}`);
  }

  console.log(`MFA 카드 전송 완료: ${spaceId}, ${username}`);
  return result;
}

// =====================
// Web App API (Worker에서 호출)
// =====================
function doGet(e) {
  const action = e.parameter.action;
  const userId = e.parameter.userId;
  const key = e.parameter.key;

  if (key !== WEB_APP_KEY) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const props = getProps();

  if (action === 'setWaiting') {
    props.setProperty(`mfa_status_${userId}`, 'WAITING');
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'WAITING' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getStatus') {
    const status = props.getProperty(`mfa_status_${userId}`) || 'NONE';
    return ContentService
      .createTextOutput(JSON.stringify({ status }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'clear') {
    props.deleteProperty(`mfa_status_${userId}`);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'CLEARED' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getUsers') {
    const users = getAllRegisteredUsers();
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, users }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const key = data.key;

    if (key !== WEB_APP_KEY) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const action = data.action;

    if (action === 'get_users') {
      const users = getAllRegisteredUsers();
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, users }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'send_mfa_card') {
      const spaceId = data.spaceId;
      const userId = data.userId;
      const username = data.username;

      sendMfaCard(spaceId, userId, username);

      return ContentService
        .createTextOutput(JSON.stringify({ success: true, message: 'MFA card sent' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost 에러:', err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================
// 모닝브리핑 Trigger 관리
// =====================
function setupMorningBriefingTrigger(hour) {
  removeMorningBriefingTrigger();

  const triggerHour = hour || 8;

  ScriptApp.newTrigger('sendMorningBriefingToAll')
    .timeBased()
    .atHour(triggerHour)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();

  console.log(`[트리거] 모닝브리핑 설정 완료 - 매일 ${triggerHour}시 실행`);
}

function removeMorningBriefingTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'sendMorningBriefingToAll') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  console.log(`[트리거] 모닝브리핑 트리거 ${removed}개 제거됨`);
  return removed;
}

function getMorningBriefingTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const briefingTriggers = triggers.filter(t => t.getHandlerFunction() === 'sendMorningBriefingToAll');

  if (briefingTriggers.length === 0) {
    console.log('[트리거] 모닝브리핑 트리거 없음');
    return { enabled: false, triggers: [] };
  }

  const triggerInfo = briefingTriggers.map(t => ({
    id: t.getUniqueId(),
    type: t.getEventType().toString(),
    handler: t.getHandlerFunction()
  }));

  console.log('[트리거] 모닝브리핑 상태:', JSON.stringify(triggerInfo));
  return { enabled: true, triggers: triggerInfo };
}

// =====================
// 모닝브리핑 - Time Trigger용
// =====================
function sendMorningBriefingToAll() {
  console.log('[모닝브리핑] 시작');

  const users = getAllRegisteredUsers();
  console.log(`[모닝브리핑] 등록된 사용자 수: ${users.length}`);

  if (users.length === 0) {
    console.log('[모닝브리핑] 등록된 사용자가 없습니다.');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  users.forEach(user => {
    try {
      sendMfaCard(user.spaceId, user.userId, user.username);
      console.log(`[모닝브리핑] 카드 전송 성공: ${user.username}`);
      successCount++;
    } catch (e) {
      console.error(`[모닝브리핑] 카드 전송 실패: ${user.username}, 에러: ${e.message}`);
      failCount++;
    }
  });

  console.log(`[모닝브리핑] 완료 - 성공: ${successCount}, 실패: ${failCount}`);
}
