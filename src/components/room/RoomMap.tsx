'use client';

import { KakaoMap, type MapPin } from '@/components/KakaoMap';
import { nicknameOf } from '@/lib/rooms';
import type { RoomDetail } from './types';

/**
 * 방의 승하차 지점을 지도에 표시한다.
 *
 * pickup_order/dropoff_order 를 핀의 order 로 그대로 넘기면
 * KakaoMap 이 알아서 ①②③ 숫자를 찍어준다.
 */
type Props = {
  room: RoomDetail;
};

export function RoomMap({ room }: Props) {
  const pins: MapPin[] = [];

  for (const m of room.room_members) {
    const nickname = nicknameOf(m.profiles);
    pins.push({
      position: { lat: m.pickup_lat, lng: m.pickup_lng },
      label: `${nickname} 승차`,
      kind: 'pickup',
      order: m.pickup_order ?? undefined,
    });
    pins.push({
      position: { lat: m.dropoff_lat, lng: m.dropoff_lng },
      label: `${nickname} 하차`,
      kind: 'dropoff',
      order: m.dropoff_order ?? undefined,
    });
  }

  return (
    <KakaoMap
      center={{ lat: room.origin_lat, lng: room.origin_lng }}
      pins={pins}
      fitPins
      className="h-64 w-full ring-1 ring-black/5"
    />
  );
}
