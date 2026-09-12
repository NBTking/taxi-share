'use client';

import { useEffect, useMemo, useState } from 'react';
import { KakaoMap, coordToAddress, type MapPin } from '@/components/KakaoMap';
import { CAMPUS, QUICK_PLACES, type Place } from '@/lib/places';
import { createClient } from '@/lib/supabase/client';
import type { MatchResult } from '@/lib/matching';
import type { LatLng } from '@/lib/types';

type Me = { id: string; nickname: string };
type Picking = 'origin' | 'destination';

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [picking, setPicking] = useState<Picking>('origin');
  const [origin, setOrigin] = useState<Place | null>(CAMPUS);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departAt, setDepartAt] = useState(() => toInputValue(new Date(Date.now() + 30 * 60_000)));

  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    soloFare: number | null;
    scanned: number;
    matches: MatchResult[];
  } | null>(null);

  // 익명 로그인. 세션이 이미 있으면 재사용하므로 계정이 쌓이지 않는다.
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
          if (!cancelled) setError('로그인에 실패했습니다. Supabase 익명 로그인이 켜져 있는지 확인하세요.');
          return;
        }
        user = data.user;
      }
      if (!user || cancelled) return;

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

  async function handlePick(point: LatLng) {
    const address = await coordToAddress(point);
    const place: Place = { ...point, address };
    if (picking === 'origin') {
      setOrigin(place);
      setPicking('destination'); // 출발지를 찍으면 자연히 다음은 도착지다
    } else {
      setDestination(place);
    }
  }

  async function handleSearch() {
    if (!me || !origin || !destination) return;
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
            pickup: { lat: origin.lat, lng: origin.lng },
            dropoff: { lat: destination.lat, lng: destination.lng },
          },
          departAt: new Date(departAt).toISOString(),
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

  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (origin) list.push({ position: origin, label: '출발', kind: 'origin' });
    if (destination) list.push({ position: destination, label: '도착', kind: 'destination' });
    return list;
  }, [origin, destination]);

  const accepted = result?.matches.filter((m) => m.accepted) ?? [];
  const canSearch = Boolean(me && origin && destination && !searching);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">같이 타요</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {me ? me.nickname : '연결 중…'}
        </span>
      </header>

      <KakaoMap
        center={destination ?? origin ?? CAMPUS}
        level={destination && origin ? 8 : 5}
        pins={pins}
        onPick={handlePick}
        className="h-64 w-full ring-1 ring-black/5"
      />

      <div className="flex gap-2 text-sm">
        {(['origin', 'destination'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setPicking(kind)}
            className={`flex-1 rounded-lg px-3 py-2 font-medium transition ${
              picking === kind
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {kind === 'origin' ? '출발지 찍기' : '도착지 찍기'}
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900">
        <Field label="출발" value={origin?.address} tone="emerald" />
        <Field label="도착" value={destination?.address} tone="rose" />

        <div className="flex flex-wrap gap-1.5 pt-1">
          {QUICK_PLACES.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => (picking === 'origin' ? setOrigin(p) : setDestination(p))}
              className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
            >
              {p.address}
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between pt-1">
          <span className="text-slate-500 dark:text-slate-400">출발 시각</span>
          <input
            type="datetime-local"
            value={departAt}
            onChange={(e) => setDepartAt(e.target.value)}
            className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleSearch}
        disabled={!canSearch}
        className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        {searching ? '경로 계산 중…' : '동승 가능한 택시 찾기'}
      </button>

      {error && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
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

function MatchCard({ match, myId }: { match: MatchResult; myId: string }) {
  const [open, setOpen] = useState(false);
  const s = match.settlement;

  return (
    <article className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="flex items-center justify-between p-4">
        <div>
          <p className="text-2xl font-bold">{won(match.myFare)}</p>
          {match.savedFare !== undefined && match.savedFare > 0 && (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {won(match.savedFare)} 절약
              {match.savedRate !== undefined && ` (${Math.round(match.savedRate * 100)}%)`}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <p>+{Math.round(match.extraDurationS / 60)}분 우회</p>
          <p>{match.pickupOrder}번째 승차</p>
          {s && <p>{s.shares.length}명 동승</p>}
        </div>
      </div>

      {s && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400"
          >
            {open ? '요금 계산 접기' : '이 금액이 나온 이유 보기'}
          </button>

          {open && (
            <div className="border-t border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
              <table className="w-full">
                <tbody>
                  {/* 같은 지점에서 연속 승하차하면 거리 0 인 구간이 생긴다. 0원 행은 혼란만 준다. */}
                  {s.segments
                    .filter((seg) => seg.distanceM > 0)
                    .map((seg) => (
                    <tr key={seg.seq} className="text-slate-600 dark:text-slate-300">
                      <td className="py-1 pr-2">
                        {seg.fromLabel} → {seg.toLabel}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {(seg.distanceM / 1000).toFixed(1)}km
                      </td>
                      <td className="py-1 pl-2 text-right tabular-nums">
                        {won(seg.segmentFare)} ÷ {seg.riderCount}명
                      </td>
                    </tr>
                  ))}
                  <tr className="text-slate-600 dark:text-slate-300">
                    <td className="py-1 pr-2" colSpan={2}>
                      기본요금{s.tollFare > 0 ? ' + 통행료' : ''}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums">
                      {won(s.baseFare + s.tollFare)} ÷ {s.shares.length}명
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                {s.shares.map((share) => (
                  <div
                    key={share.riderId}
                    className={`flex justify-between ${
                      share.riderId === myId
                        ? 'font-semibold text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <span>
                      {share.nickname}
                      {share.riderId === myId && ' (나)'}
                    </span>
                    <span className="tabular-nums">{won(share.finalFare)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 text-slate-400">
                  <span>택시 총요금</span>
                  <span className="tabular-nums">{won(s.totalFare)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone: 'emerald' | 'rose';
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          tone === 'emerald' ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />
      <span className="w-8 shrink-0 text-slate-400">{label}</span>
      <span className={value ? '' : 'text-slate-400'}>{value ?? '지도를 눌러 선택하세요'}</span>
    </div>
  );
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** Date → datetime-local 입력값 (로컬 시간 기준) */
function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
