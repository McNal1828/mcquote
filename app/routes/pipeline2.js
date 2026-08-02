// 🔒 보안용 API 키 (웹앱 서버 인증 키와 동일해야 함)
const WEBAPP_SECRET_KEY = "dptmeldkdltkdjqqnqlalfqjsgh";

// 🌐 로컬 개발(ngrok 등) 또는 실제 배포된 웹앱의 웹훅 API 수신 URL로 변경해주세요.
const WEBAPP_WEBHOOK_URL = "https://<YOUR_DOMAIN_OR_NGROK>/api/sync-sheet";

/**
 * ⚠️ [중요 - 필수 보안 설정 안내]
 * Google 샌드박스 보안 정책상, 단순 내장 함수인 'onEdit(e)'에서는 UrlFetchApp.fetch (외부 HTTP 호출)를 사용할 수 없습니다.
 * Therefore, to execute this code normally, the following installation process is required:
 * 
 * 1. Google Apps Script 에디터 우측 메뉴의 [트리거 (알람 시계 아이콘 ⏰)] 메뉴로 이동합니다.
 * 2. 우측 하단의 [+ 트리거 추가] 단추를 클릭합니다.
 * 3. 다음과 같이 옵션을 설정하고 저장합니다:
 *    - 실행할 함수 선택: 'handleInstallableEdit'
 *    - 실행할 배포 버전 선택: '기본값(Head)'
 *    - 이벤트 소스 선택: '스프레드시트에서'
 *    - 이벤트 유형 선택: '수정 시'
 * 4. 최초 저장 시 구글 계정 권한 승인 창(OAuth 승인)이 뜨면 권한을 수락(허용)해 주어야 정상 구동됩니다.
 */
function handleInstallableEdit(e) {
  try {
    const range = e.range;
    const sheet = range.getSheet();
    
    // 🎯 특정 시트 이름 필터링 (동기화 대상 시트)
    if (sheet.getName() !== 'TestPipeline') return;

    const col = range.getColumn();
    const row = range.getRow();

    // M열(13번째: Project Code), N열(14번째: Stage), O열(15번째: Net Dollar), P열(16번째: 공급가), Q열(17번째: 마진), S열(19번째: 대표비고)이 수정된 경우
    if (row >= 2 && (col === 13 || col === 14 || col === 15 || col === 16 || col === 17 || col === 19)) {
      const id = sheet.getRange(row, 4).getValue(); // D열(4번째)의 고유 ID (quote_lines.id) 취득
      
      // ID가 빈값이면 동기화할 타겟을 잡을 수 없으므로 스킵
      if (!id) return;

      const projectCode = sheet.getRange(row, 13).getValue(); // M열: Project Code
      const rawStage = sheet.getRange(row, 14).getValue();   // N열: Stage
      const netdollar = sheet.getRange(row, 15).getValue();  // O열: Net Dollar ($) (netdollar)
      const supplyPrice = sheet.getRange(row, 16).getValue(); // P열: 공급가 수동 입력 값
      const margin = sheet.getRange(row, 17).getValue();       // Q열: 마진 수동 입력 값
      const gasNote = sheet.getRange(row, 19).getValue();      // S열: 대표비고 (gasNote)

      const stageVal = (rawStage !== undefined && rawStage !== null && rawStage !== "") 
        ? Math.round(Number(rawStage) * 100) 
        : 10;

      const netdollarNum = Number(netdollar) || 0;
      const supplyPriceNum = Number(supplyPrice) || 0;
      const marginNum = Number(margin) || 0;
      const marginRateNum = supplyPriceNum > 0 ? parseFloat(((marginNum / supplyPriceNum) * 100).toFixed(1)) : 0;

      const payload = {
        apiKey: WEBAPP_SECRET_KEY,
        id: Number(id),
        stage: stageVal,
        netdollar: netdollarNum,
        supplyPrice: supplyPriceNum,
        margin: marginNum,
        marginRate: marginRateNum,
        gasNote: gasNote !== undefined && gasNote !== null ? String(gasNote) : "",
        projectCode: projectCode !== undefined && projectCode !== null ? String(projectCode) : ""
      };

      const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      // 웹앱의 동기화 API 엔드포인트 호출
      const response = UrlFetchApp.fetch(WEBAPP_WEBHOOK_URL, options);
      
      // 디버그용 실행 로그 기록 (Google Apps Script [실행] 탭에서 확인 가능)
      Logger.log("웹훅 전송 요청 페이로드: " + JSON.stringify(payload));
      Logger.log("웹훅 전송 결과 코드: " + response.getResponseCode());
      Logger.log("웹훅 전송 응답 내용: " + response.getContentText());
    }
  } catch (err) {
    Logger.log("웹훅 전송 에방/대응 실패: " + err.toString());
  }
}
