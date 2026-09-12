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

/** Date → time 입력값 ("21:30") */
export function toTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "21:30" → 그 시각이 오는 가장 가까운 Date.
 *
 * 이미 지난 시각이면 내일로 본다. 심야 이동 서비스라
 * 밤 11시에 "00:30 출발" 을 예약하는 경우가 흔하다.
 */
export function nextOccurrence(time: string, now: Date = new Date()): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** ISO 문자열 → "오후 7:42" */
export function toClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

/**
 * ISO 문자열 → "12분 뒤" / "곧 출발" / "1시간 20분 뒤"
 * 시계 시각만 보면 얼마나 남았는지 암산해야 한다. 둘 다 보여주는 편이 빠르다.
 */
export function fromNow(iso: string, now: Date = new Date()): string {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) return '곧 출발';
  if (diffMin < 60) return `${diffMin}분 뒤`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `${h}시간 뒤` : `${h}시간 ${m}분 뒤`;
}

/**
 * 정산표에 표시할 최소 구간 거리(m).
 *
 * 같은 지점에서 두 사람이 연달아 타고 내리면 수십 미터짜리 구간이 생기는데,
 * "0.0km 1원 ÷ 1명" 같은 행은 근거가 아니라 잡음이다.
 */
export const MIN_SEGMENT_M = 100;
