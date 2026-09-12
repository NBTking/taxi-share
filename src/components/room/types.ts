/**
 * 방 상세 화면 전용 타입 별칭.
 *
 * lib/rooms.ts 가 이제 dropoff_order·final_fare·fare_segments 까지 포함한
 * ROOM_WITH_SEGMENTS_SELECT/RoomRow 를 제공한다 (/api/rooms/[id]/settle 이 추가되며 함께 생김).
 * 여기서 따로 타입을 만들면 그쪽과 갈라져 "매칭에서 본 금액과 방 상세 금액이 다르다"는
 * 사고가 날 수 있으므로 그대로 재사용한다.
 */
export {
  ROOM_WITH_SEGMENTS_SELECT as ROOM_DETAIL_SELECT,
  type RoomRow as RoomDetail,
  type RoomMemberRow as RoomMemberDetail,
  type FareSegmentRow,
} from '@/lib/rooms';
