'use client';

import { useState } from 'react';
import { MatchCard } from '@/components/MatchCard';
import { TripForm, type Trip } from '@/components/TripForm';
import { won } from '@/lib/format';
import type { MatchResponse } from '@/lib/matching';
import { useMe } from '@/lib/useMe';

/**
 * 홈 화면.
 *
 * 여기는 "조각을 배치하고 API 를 부르는 곳"만 담당한다.
 * 출발지/도착지 입력은 TripForm 이, 매칭 결과 표시는 MatchCard 가 각자 알아서 한다.
 * (세 명이 동시에 작업해도 서로 같은 파일을 건드리지 않도록 나눠둔 구조다)
 */
export default function Home() {
  const { me, error: authError } = useMe();

  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResponse | null>(null);

  async function handleSearch(trip: Trip) {
    if (!me) return;
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rider: {
            id: me.id,
            nickname: me.nickname,
            pickup: { lat: trip.origin.lat, lng: trip.origin.lng },
            dropoff: { lat: trip.destination.lat, lng: trip.destination.lng },
          },
          departAt: trip.departAt,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '매칭에 실패했습니다');
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '매칭에 실패했습니다');
    } finally {
      setSearching(false);
    }
  }

  const accepted = result?.matches.filter((m) => m.accepted) ?? [];
  const shownError = error ?? authError;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">같이 타요</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {me ? me.nickname : '연결 중…'}
        </span>
      </header>

      <TripForm onSearch={handleSearch} searching={searching} disabled={!me} />

      {shownError && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {shownError}
        </p>
      )}

      {result && (
        <section className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {accepted.length > 0
              ? `동승 가능한 택시 ${accepted.length}대`
              : '조건에 맞는 택시가 없습니다'}
            {result.soloFare ? ` · 혼자 타면 ${won(result.soloFare)}` : ''}
          </p>

          {accepted.map((m) => (
            <MatchCard key={m.roomId} match={m} myId={me?.id ?? ''} />
          ))}

          {result.scanned > accepted.length && (
            <p className="text-xs text-slate-400">
              근처 {result.scanned}개 방 중 {result.scanned - accepted.length}개는 경로·시간이 맞지
              않아 제외됐습니다.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
