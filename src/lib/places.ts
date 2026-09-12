import type { LatLng } from './types';

export type Place = LatLng & { address: string };

/**
 * 데모용 고정 지점. 좌표는 카카오 장소검색으로 확인한 실제 위치다.
 *
 * 고려대 안암캠퍼스에서 심야에 강남 방향으로 나가는 동선을 기준으로 잡았다.
 * 고려대 → 강남역 직선에서의 이탈거리(회랑 임계 2,000m):
 *   왕십리역   774m   ← 가는 길에 픽업
 *   압구정역    32m   ← 가는 길에 하차
 *   건대입구역 3,615m ← 회랑 밖 (필터에 걸림)
 *   신촌역    8,055m ← 반대 방향 (필터에 걸림)
 *
 * ★ 다른 장소에서 시연하려면 HUB 를 바꾸고 `npx tsx scripts/seed.mts` 를 다시 돌린다.
 *   좌표는 카카오맵에서 우클릭 > "여기가 어디죠?" 로 확인할 수 있다.
 */

/** 고려대학교 서울캠퍼스 정운오IT교양관 */
export const KU: Place = { lat: 37.584467, lng: 127.028446, address: '고려대 정운오IT교양관' };
export const GANGNAM: Place = { lat: 37.498086, lng: 127.028001, address: '강남역' };
/** 고려대→강남 경로 중간. '가는 길에 픽업' 데모용 */
export const WANGSIMNI: Place = { lat: 37.561268, lng: 127.037103, address: '왕십리역' };
/** 고려대→강남 경로 중간. '가는 길에 하차' 데모용 */
export const APGUJEONG: Place = { lat: 37.526491, lng: 127.028509, address: '압구정역' };
export const KONKUK: Place = { lat: 37.540408, lng: 127.069203, address: '건대입구역' };
export const SINCHON: Place = { lat: 37.555198, lng: 126.936981, address: '신촌역' };

/**
 * 기본 출발 지점. 위치 권한을 거부당했을 때의 폴백이자 시드의 기준점이다.
 * 다른 곳에서 시연하려면 여기만 바꾼다.
 */
export const HUB: Place = KU;

/** 홈 화면의 빠른 선택 버튼. 순서가 곧 화면 순서다. */
export const QUICK_PLACES: Place[] = [KU, WANGSIMNI, APGUJEONG, GANGNAM, KONKUK, SINCHON];
