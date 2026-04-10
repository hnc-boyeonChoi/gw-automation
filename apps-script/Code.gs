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
