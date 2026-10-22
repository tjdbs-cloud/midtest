/**
 * INU 벽돌깨기 - Google Apps Script (GAS) CRUD API
 * 
 * 스프레드시트 ID: 1vg85lgDzl7zWR7ujoqjmYBZ_Y70EhirZ3jrAh1QFtWo
 * 시트 헤더 구성:
 * Column A: timestamp  (기록 일시, 예: 2026-10-22 14:55:00)
 * Column B: name       (사용자 이름)
 * Column C: finishtime (게임 완료 소요 시간, 분:초 형식 예: 01:23)
 */

const SPREADSHEET_ID = "1vg85lgDzl7zWR7ujoqjmYBZ_Y70EhirZ3jrAh1QFtWo";
const SHEET_NAME = "Sheet1"; // 시트 이름에 맞게 필요시 변경 (기본값 Sheet1 또는 첫 번째 시트)

function getTargetSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  return sheet;
}

/**
 * 1. GET 요청 핸들러 (READ)
 * 파라미터:
 * - action: "read"
 * - name: (선택) 특정 사용자 이름으로 필터링
 * 
 * 예시 URL:
 * https://script.google.com/macros/s/DEPLOY_ID/exec?action=read
 * https://script.google.com/macros/s/DEPLOY_ID/exec?action=read&name=홍길동
 */
function doGet(e) {
  try {
    const params = e ? e.parameter : {};
    const action = params.action || "read";

    if (action === "read") {
      const sheet = getTargetSheet();
      const lastRow = sheet.getLastRow();

      if (lastRow <= 1) {
        return createJsonResponse({ status: "success", data: [] });
      }

      // 1행은 헤더 (timestamp, name, finishtime)
      const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
      let records = rows.map((row, index) => {
        // 날짜 포맷 변환 (필요시)
        let ts = row[0];
        if (ts instanceof Date) {
          ts = Utilities.formatDate(ts, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
        }
        
        let ft = row[2];
        if (ft instanceof Date) {
          ft = Utilities.formatDate(ft, "Asia/Seoul", "mm:ss");
        } else {
          ft = String(ft || "");
        }

        return {
          rowId: index + 2, // 시트 실제 행 번호
          timestamp: ts,
          name: String(row[1] || ""),
          finishtime: ft // "분:초" (예: "01:24")
        };
      });

      // 이름 필터링 옵션
      if (params.name) {
        records = records.filter(r => r.name === params.name);
      }

      return createJsonResponse({ status: "success", count: records.length, data: records });
    }

    return createJsonResponse({ status: "error", message: "알 수 없는 GET action입니다." });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

/**
 * 2. POST 요청 핸들러 (CREATE, UPDATE, DELETE)
 * 
 * Content-Type: application/json 또는 application/x-www-form-urlencoded
 * Payload 예시:
 * 
 * 1) CREATE (기록 추가):
 * {
 *   "action": "create",
 *   "name": "장서윤",
 *   "finishtime": "01:15" // 분:초
 * }
 * 
 * 2) UPDATE (기록 수정 - rowId 또는 name 기준):
 * {
 *   "action": "update",
 *   "rowId": 2, // 또는 "name": "장서윤"
 *   "finishtime": "00:58"
 * }
 * 
 * 3) DELETE (기록 삭제 - rowId 또는 name 기준):
 * {
 *   "action": "delete",
 *   "rowId": 2 // 또는 "name": "장서윤"
 * }
 */
function doPost(e) {
  try {
    let body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      body = e.parameter;
    }

    const action = body.action || "create";
    const sheet = getTargetSheet();

    // 1행 헤더 확인 및 자동 생성
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["timestamp", "name", "finishtime"]);
    }

    // --- CREATE ---
    if (action === "create") {
      const name = body.name || "익명";
      const finishtime = body.finishtime || "00:00"; // '분:초' (MM:SS)
      const now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

      sheet.appendRow([now, name, finishtime]);

      return createJsonResponse({
        status: "success",
        message: "성공적으로 기록되었습니다.",
        data: {
          timestamp: now,
          name: name,
          finishtime: finishtime
        }
      });
    }

    // --- UPDATE ---
    if (action === "update") {
      const lastRow = sheet.getLastRow();
      let targetRow = body.rowId ? parseInt(body.rowId) : null;

      // name으로 행 찾기
      if (!targetRow && body.name) {
        const names = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
        for (let i = 0; i < names.length; i++) {
          if (names[i][0] === body.name) {
            targetRow = i + 2;
            break;
          }
        }
      }

      if (!targetRow || targetRow < 2 || targetRow > lastRow) {
        return createJsonResponse({ status: "error", message: "수정할 대상을 찾을 수 없습니다." });
      }

      // finishtime 수정
      if (body.finishtime) {
        sheet.getRange(targetRow, 3).setValue(body.finishtime);
      }
      // timestamp 갱신 (선택 사항)
      const updatedTimestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
      sheet.getRange(targetRow, 1).setValue(updatedTimestamp);

      return createJsonResponse({
        status: "success",
        message: "성공적으로 수정되었습니다.",
        data: { rowId: targetRow, finishtime: body.finishtime, timestamp: updatedTimestamp }
      });
    }

    // --- DELETE ---
    if (action === "delete") {
      const lastRow = sheet.getLastRow();
      let targetRow = body.rowId ? parseInt(body.rowId) : null;

      if (!targetRow && body.name) {
        const names = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
        for (let i = 0; i < names.length; i++) {
          if (names[i][0] === body.name) {
            targetRow = i + 2;
            break;
          }
        }
      }

      if (!targetRow || targetRow < 2 || targetRow > lastRow) {
        return createJsonResponse({ status: "error", message: "삭제할 대상을 찾을 수 없습니다." });
      }

      sheet.deleteRow(targetRow);
      return createJsonResponse({ status: "success", message: targetRow + "행이 삭제되었습니다." });
    }

    return createJsonResponse({ status: "error", message: "유효하지 않은 POST action입니다." });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

/**
 * JSON 응답 생성 도우미 (CORS 대응)
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 초기 시트 헤더 세팅 함수 (GAS 에디터에서 직접 실행 가능)
 */
function initSheetHeader() {
  const sheet = getTargetSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["timestamp", "name", "finishtime"]);
    // 헤더 스타일 서식
    const headerRange = sheet.getRange(1, 1, 1, 3);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#e2e8f0");
  }
}
