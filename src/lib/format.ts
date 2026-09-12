/**
 * 표시용 포매터. 화면 어디서나 같은 형식으로 보이게 하려고 한곳에 모은다.
 *
 * 🔒 공용 파일 — 바꾸면 세 화면이 전부 영향을 받는다. 수정 전 팀에 공유할 것.
 */

/** 1234567 → "1,234,567원" */
export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 초 → "17분" (우회 시간 표시용) */
export const minutes = (seconds: number) => `${Math.round(seconds / 60)}분`;

/** 미터 → "20.5km" */
export const km = (meters: number) => `${(meters / 1000).toFixed(1)}km`;

/** Date → datetime-local 입력값. toISOString 은 UTC 라 쓸 수 없다. */
export function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
