'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ROOM_DETAIL_SELECT, type RoomDetail } from './types';

/**
 * 방 상세 데이터 + 실시간 갱신.
 *
 * API 를 기다릴 필요 없이 Supabase 에서 직접 읽는다. room_members 가 바뀌면
 * (누가 합류하면) realtime 이 다시 읽어와 화면이 즉시 갱신된다.
 * schema.sql 에서 이미 publication 에 등록해 둔 테이블이라 채널만 열면 된다.
 */
export function useRoomDetail(roomId: string) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRoom = useCallback(async () => {
    const supabase = createClient();
    return supabase.from('rooms').select(ROOM_DETAIL_SELECT).eq('id', roomId).single();
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;

    function applyResult({ data, error: fetchError }: Awaited<ReturnType<typeof fetchRoom>>) {
      if (cancelled) return;
      if (fetchError) {
        setError('방을 불러오지 못했습니다');
        setLoading(false);
        return;
      }
      setRoom(data as unknown as RoomDetail);
      setError(null);
      setLoading(false);
    }

    fetchRoom().then(applyResult);

    const supabase = createClient();
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
        () => {
          fetchRoom().then(applyResult);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, fetchRoom]);

  return { room, loading, error };
}
