/**
 * Google Apps Script (Google Sheets) CRUD Helper
 * Uses NEXT_PUBLIC_GOOGLE_SCRIPT_URL from .env.local
 */

export interface SheetRecord {
  rowId?: number;
  timestamp?: string;
  name: string;
  finishtime: string; // "MM:SS"
}

const SCRIPT_URL = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || "";

/**
 * MM:SS 형식을 초(seconds) 단위로 파싱
 */
export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 999999;
  
  // 만약 Date 문자열 등이 섞여 들어왔을 경우 방어 처리
  if (timeStr.includes("GMT") || timeStr.includes(":")) {
    const parts = timeStr.trim().split(":");
    if (parts.length >= 2) {
      const min = parseInt(parts[parts.length - 2], 10);
      const sec = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(min) && !isNaN(sec)) {
        return min * 60 + sec;
      }
    }
  }

  const parts = timeStr.trim().split(":");
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10);
    const sec = parseInt(parts[1], 10);
    if (!isNaN(min) && !isNaN(sec)) {
      return min * 60 + sec;
    }
  }
  return 999999;
}

/**
 * 어떤 형태의 문자열(Date, GMT 문자열 등)이 오더라도 순수 '분:초' (MM:SS) 형식으로 정제
 */
export function cleanTimeToMinSec(timeStr: string): string {
  const totalSec = parseTimeToSeconds(timeStr);
  if (totalSec >= 999999) return "00:00";
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * 1. CREATE: 새 게임 클리어 기록 저장
 */
export async function createScoreRecord(name: string, finishtime: string): Promise<boolean> {
  if (!SCRIPT_URL) {
    console.warn("NEXT_PUBLIC_GOOGLE_SCRIPT_URL is not defined in .env.local");
    return false;
  }

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action: "create",
        name,
        finishtime,
      }),
    });
    const data = await res.json();
    return data.status === "success";
  } catch (err) {
    console.error("Failed to save record to Google Sheets:", err);
    return false;
  }
}

/**
 * 2. READ: 시트에서 모든 기록 조회
 */
export async function fetchScoreRecords(): Promise<SheetRecord[]> {
  if (!SCRIPT_URL) {
    console.warn("NEXT_PUBLIC_GOOGLE_SCRIPT_URL is not defined in .env.local");
    return [];
  }

  try {
    const res = await fetch(`${SCRIPT_URL}?action=read`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await res.json();
    if (data.status === "success" && Array.isArray(data.data)) {
      return data.data;
    }
    return [];
  } catch (err) {
    console.error("Failed to fetch records from Google Sheets:", err);
    return [];
  }
}

/**
 * 3. UPDATE: 특정 행/사용자 기록 수정
 */
export async function updateScoreRecord(
  identifier: { rowId?: number; name?: string },
  finishtime: string
): Promise<boolean> {
  if (!SCRIPT_URL) return false;

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action: "update",
        ...identifier,
        finishtime,
      }),
    });
    const data = await res.json();
    return data.status === "success";
  } catch (err) {
    console.error("Failed to update record in Google Sheets:", err);
    return false;
  }
}

/**
 * 4. DELETE: 특정 행/사용자 기록 삭제
 */
export async function deleteScoreRecord(identifier: {
  rowId?: number;
  name?: string;
}): Promise<boolean> {
  if (!SCRIPT_URL) return false;

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action: "delete",
        ...identifier,
      }),
    });
    const data = await res.json();
    return data.status === "success";
  } catch (err) {
    console.error("Failed to delete record from Google Sheets:", err);
    return false;
  }
}

/**
 * 전체 기록에서 소요 시간이 가장 빠른 상위 3개(Top 3) 추출 (순수 분:초 형식 보장)
 */
export function getTop3Records(records: SheetRecord[]): SheetRecord[] {
  return [...records]
    .filter((r) => r.finishtime)
    .sort((a, b) => {
      const secA = parseTimeToSeconds(a.finishtime);
      const secB = parseTimeToSeconds(b.finishtime);
      return secA - secB;
    })
    .slice(0, 3)
    .map((r) => ({
      ...r,
      finishtime: cleanTimeToMinSec(r.finishtime),
    }));
}
