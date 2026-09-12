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
  const [lastTrip, setLastTrip] = useState<Trip | null>(null);

  async function handleSearch(trip: Trip) {
    if (!me) return;
    setLastTrip(trip);
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
        <div className="space-y-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          <p>{shownError}</p>
          {error && lastTrip && (
            <button
              type="button"
              onClick={() => handleSearch(lastTrip)}
              className="rounded-md bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-200 dark:bg-rose-900/50 dark:text-rose-200 dark:hover:bg-rose-900"
            >
              다시 시도
            </button>
          )}
        </div>
      )}

      {searching && (
        <section className="space-y-3" aria-live="polite" aria-busy="true">
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
            />
          ))}
        </section>
      )}

      {!searching && result && (
        <section className="space-y-3">
          {accepted.length > 0 ? (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                동승 가능한 택시 {accepted.length}대
                {result.soloFare ? ` · 혼자 타면 ${won(result.soloFare)}` : ''}
              </p>

              {accepted.map((m) => (
                <MatchCard key={m.roomId} match={m} myId={me?.id ?? ''} />
              ))}

              {result.scanned > accepted.length && (
                <p className="text-xs text-slate-400">
                  근처 {result.scanned}개 방 중 {result.scanned - accepted.length}개는 경로·시간이
                  맞지 않아 제외됐습니다.
                </p>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                조건에 맞는 동승 택시가 없어요
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                출발 시각을 조금 조정하거나 잠시 후 다시 찾아보세요.
              </p>
              {result.soloFare && (
                <p className="mt-2 text-xs text-slate-400">혼자 타면 {won(result.soloFare)}</p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
