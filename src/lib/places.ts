import type { LatLng } from './types';

export type Place = LatLng & { address: string };

/**
 * 고정 지점. 좌표는 카카오 장소검색으로 확인한 실제 위치다.
 *
 * 고려대 안암캠퍼스에서 심야에 강남 방향으로 나가는 동선이 기준이다.
 * 데모 방(src/lib/demo-rooms.ts)이 이 지점들을 조합해 여러 경로를 만든다.
 *
 * ★ 다른 장소에서 시연하려면 HUB 를 바꾸고 `npx tsx scripts/seed.mts` 를 다시 돌린다.
 *   좌표는 카카오맵에서 우클릭 > "여기가 어디죠?" 로 확인할 수 있다.
 */

/** 고려대학교 서울캠퍼스 정운오IT교양관 */
export const KU: Place = { lat: 37.584467, lng: 127.028446, address: '고려대 정운오IT교양관' };

// --- 북쪽 (고려대 위. 여기서 출발해 고려대를 지나간다) ---
export const MIA: Place = { lat: 37.613278, lng: 127.030087, address: '미아사거리역' };
export const SUNGSHIN: Place = { lat: 37.592968, lng: 127.017126, address: '성신여대입구역' };
export const CHEONGNYANGNI: Place = { lat: 37.57997, lng: 127.047736, address: '청량리역' };
export const HOEGI: Place = { lat: 37.589796, lng: 127.058048, address: '회기역' };

// --- 중간 (가는 길에 태우고 내려주는 지점) ---
export const WANGSIMNI: Place = { lat: 37.561268, lng: 127.037103, address: '왕십리역' };
export const SINDANG: Place = { lat: 37.565673, lng: 127.019478, address: '신당역' };
export const HANNAM: Place = { lat: 37.529429, lng: 127.009209, address: '한남역' };
export const APGUJEONG: Place = { lat: 37.526491, lng: 127.028509, address: '압구정역' };
export const SINSA: Place = { lat: 37.516436, lng: 127.020309, address: '신사역' };

// --- 남쪽 (도착지) ---
export const SINNONHYEON: Place = { lat: 37.504811, lng: 127.025492, address: '신논현역' };
export const GANGNAM: Place = { lat: 37.498086, lng: 127.028001, address: '강남역' };
export const GYODAE: Place = { lat: 37.492743, lng: 127.013868, address: '교대역' };
export const YANGJAE: Place = { lat: 37.484577, lng: 127.034164, address: '양재역' };

// --- 다른 방향 (매칭 필터에 걸리는 경로를 만들 때) ---
export const KONKUK: Place = { lat: 37.540408, lng: 127.069203, address: '건대입구역' };
export const JAMSIL: Place = { lat: 37.513311, lng: 127.100231, address: '잠실역' };
export const SADANG: Place = { lat: 37.476562, lng: 126.981559, address: '사당역' };
export const SINCHON: Place = { lat: 37.555198, lng: 126.936981, address: '신촌역' };
export const HONGDAE: Place = { lat: 37.556871, lng: 126.923779, address: '홍대입구역' };

/**
 * 기본 출발 지점. 위치 권한을 거부당했을 때의 폴백이자 데모 방의 기준점이다.
 * 다른 곳에서 시연하려면 여기만 바꾼다.
 */
export const HUB: Place = KU;

/** 홈 화면의 빠른 선택 버튼. 순서가 곧 화면 순서다. */
export const QUICK_PLACES: Place[] = [KU, WANGSIMNI, APGUJEONG, GANGNAM, YANGJAE, KONKUK, SINCHON];
