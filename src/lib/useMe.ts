'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * 현재 사용자. 세션이 없으면 익명으로 가입시킨다.
 *
 * 해커톤 데모에서 회원가입 폼을 채우게 만들면 시연이 늘어지므로
 * 첫 진입에 바로 계정을 만들어준다. 세션은 localStorage 에 남으므로
 * 새로고침해도 같은 사람으로 유지된다.
 *
 * ★ 로그인 작업을 모듈 수준에서 한 번만 수행한다.
 *   이 훅은 한 화면에서 여러 번 호출되는데(page + MatchCard 등),
 *   각자 signInAnonymously 를 부르면 사용자가 동시에 여러 명 만들어진다.
 *   그러면 localStorage 에 남는 사람과 방을 만든 사람이 달라져
 *   "내가 방장인데 방장으로 인식되지 않는" 버그가 생긴다.
 */

export type Me = { id: string; nickname: string };
type LoadResult = { me: Me | null; error: string | null };

/** 진행 중이거나 완료된 로그인. 동시 호출을 하나로 합친다. */
let pending: Promise<LoadResult> | null = null;

function loadMe(): Promise<LoadResult> {
  pending ??= (async (): Promise<LoadResult> => {
    const supabase = createClient();
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
        // 다음 마운트에서 다시 시도할 수 있도록 실패는 캐시하지 않는다
        pending = null;
        return {
          me: null,
          error: '로그인에 실패했습니다. Supabase 익명 로그인이 켜져 있는지 확인하세요.',
        };
      }
      user = data.user;
    }
    if (!user) {
      pending = null;
      return { me: null, error: '로그인에 실패했습니다' };
    }

    // 닉네임은 가입 트리거가 profiles 에 넣어준다 (supabase/schema.sql 참고)
    const { data: profile } = await supabase
      .from('profiles')
      .select('nickname')
      .eq('id', user.id)
      .single();

    return {
      me: {
        id: user.id,
        nickname: profile?.nickname ?? (user.user_metadata?.nickname as string) ?? '나',
      },
      error: null,
    };
  })();

  return pending;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMe().then((result) => {
      if (cancelled) return;
      setMe(result.me);
      setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { me, error };
}
