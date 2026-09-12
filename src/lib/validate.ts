import type { LatLng } from './types';

/**
 * API 라우트 공용 입력 검증.
 *
 * 라우트마다 같은 좌표 검증을 복사해두면 한쪽만 고쳐져서 갈라진다.
 * 성공하면 값을, 실패하면 사용자에게 그대로 보여줄 한국어 메시지를 돌려준다.
 */

export function parseLatLng(value: unknown, field: string): LatLng | string {
  if (typeof value !== 'object' || value === null) return `${field} 가 없거나 객체가 아닙니다`;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return `${field}.lat 이 올바르지 않습니다`;
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return `${field}.lng 이 올바르지 않습니다`;
  }
  return { lat, lng };
}

/** 값이 양수가 아니면 기본값으로 대체한다. */
export function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 주소 문자열이 없으면 좌표를 사람이 읽을 수 있는 형태로 대신 쓴다. */
export function addressOr(value: unknown, point: LatLng): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

/** 빈 문자열이 아닌 문자열인지 */
export function requireText(value: unknown, field: string): string | { error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { error: `${field} 가 없습니다` };
  }
  return value.trim();
}
