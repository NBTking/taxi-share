import type { LatLng } from './types';

export type Place = LatLng & { address: string };

/**
 * 데모용 고정 지점.
 *
 * ★ 우리 학교 기준으로 바꾸려면 CAMPUS 만 수정하면 된다.
 *   시드 스크립트(scripts/seed.mts)와 홈 화면의 빠른 선택 버튼이 모두 여기를 참조한다.
 *   좌표는 카카오맵에서 우클릭 > "여기가 어디죠?" 로 확인할 수 있다.
 */
export const CAMPUS: Place = { lat: 37.4979, lng: 127.0276, address: '캠퍼스 정문' };

export const GANGNAM: Place = { lat: 37.3595, lng: 127.1058, address: '강남역 11번 출구' };
export const SADANG: Place = { lat: 37.4766, lng: 126.9816, address: '사당역 4번 출구' };
export const PANGYO: Place = { lat: 37.3947, lng: 127.1112, address: '판교역 2번 출구' };

/** 홈 화면의 빠른 선택 버튼 */
export const QUICK_PLACES: Place[] = [CAMPUS, GANGNAM, SADANG, PANGYO];
