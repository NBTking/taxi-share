import type { LatLng } from './types';

export type Place = LatLng & { address: string };

/**
 * 데모용 고정 지점.
 *
 * 좌표는 카카오 역지오코딩으로 실제 위치를 확인한 값이다.
 * "강남역 → 청계산입구 → 판교 → 정자역" 은 경부고속도로 라인이라
 * 심야에 강남역에서 분당·판교 방향으로 나가는 실제 동선과 일치한다.
 *
 * ★ 다른 지역(학교/행사장)에서 시연하려면 HUB 를 바꾸고
 *   `npx tsx scripts/seed.mts` 를 다시 돌리면 된다.
 *   좌표는 카카오맵에서 우클릭 > "여기가 어디죠?" 로 확인할 수 있다.
 */

/** 서울 서초구 서초동 1373 */
export const GANGNAM: Place = { lat: 37.4979, lng: 127.0276, address: '강남역' };
/** 서울 서초구 원지동 — 강남→분당 경로 중간. '가는 길에 픽업' 데모용 */
export const CHEONGGYESAN: Place = { lat: 37.445, lng: 127.056, address: '청계산입구역' };
/** 성남시 분당구 분당내곡로 121 */
export const PANGYO: Place = { lat: 37.3947, lng: 127.1112, address: '판교역' };
/** 성남시 분당구 불정로 6 */
export const JEONGJA: Place = { lat: 37.3595, lng: 127.1058, address: '정자역' };
/** 서울 동작구 동작대로 지하 3 */
export const SADANG: Place = { lat: 37.4766, lng: 126.9816, address: '사당역' };
/** 성남시 분당구 궁내동 — 정자역 조금 못 미친 지점 */
export const GUNNAE: Place = { lat: 37.366, lng: 127.101, address: '분당 궁내동' };

/**
 * 기본 출발 지점. 위치 권한을 거부당했을 때의 폴백이자 시드의 기준점이다.
 * 다른 곳에서 시연하려면 여기만 바꾼다.
 */
export const HUB: Place = GANGNAM;

/** 홈 화면의 빠른 선택 버튼. 순서가 곧 화면 순서다. */
export const QUICK_PLACES: Place[] = [GANGNAM, CHEONGGYESAN, PANGYO, JEONGJA, SADANG];
