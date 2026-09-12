'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * 현재 사용자. 세션이 없으면 익명으로 가입시킨다.
 *
 * 해커톤 데모에서 회원가입 폼을 채우게 만들면 시연이 늘어지므로
 * 첫 진입에 바로 계정을 만들어준다. 세션은 localStorage 에 남으므로
 * 새로고침해도 같은 사람으로 유지되고 계정이 쌓이지 않는다.
 *
 * 방 상세 화면에서도 "내가 누구인지"가 필요하므로 훅으로 분리해 둔다.
 */

export type Me = { id: string; nickname: string };

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      let user = session?.user ?? null;
      if (!user) {
        const nickname = `게스트${Math.floor(1000 + Math.random() * 9000)}`;
        const { data, error } = await supabase.auth.signInAnonymously({
          options: { data: { nickname } },
        });
        if (error) {
          if (!cancelled) {
            setError('로그인에 실패했습니다. Supabase 익명 로그인이 켜져 있는지 확인하세요.');
          }
          return;
        }
        user = data.user;
      }
      if (!user || cancelled) return;

      // 닉네임은 가입 트리거가 profiles 에 넣어준다 (supabase/schema.sql 참고)
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('id', user.id)
        .single();

      setMe({
        id: user.id,
        nickname: profile?.nickname ?? (user.user_metadata?.nickname as string) ?? '나',
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { me, error };
}
