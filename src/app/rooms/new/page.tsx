'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KakaoMap, coordToAddress, type MapPin } from '@/components/KakaoMap';
import { PlaceSearch } from '@/components/PlaceSearch';
import { toDateTimeLocal } from '@/lib/format';
import { HUB, QUICK_PLACES, type Place } from '@/lib/places';
import type { CreateRoomResponse } from '@/lib/rooms';
import type { LatLng } from '@/lib/types';
import { useMe } from '@/lib/useMe';

/**
 * 방 만들기.
 *
 * TripForm 과 같은 방식(지도 클릭/검색/빠른 선택)으로 출발·도착을 고른다.
 * POST /api/rooms 로 방을 만들고, 성공하면 방 상세로 이동한다.
 */

type Picking = 'origin' | 'destination';

export default function NewRoomPage() {
  const router = useRouter();
  const { me, error: authError } = useMe();

  const [picking, setPicking] = useState<Picking>('origin');
  const [origin, setOrigin] = useState<Place | null>(HUB);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departAt, setDepartAt] = useState(() =>
    toDateTimeLocal(new Date(Date.now() + 30 * 60_000)),
  );
  const [capacity, setCapacity] = useState(4);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMapPick(point: LatLng) {
    const place: Place = { ...point, address: await coordToAddress(point) };
    if (picking === 'origin') {
      setOrigin(place);
      setPicking('destination');
    } else {
      setDestination(place);
    }
  }

  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (origin) list.push({ position: origin, label: '출발', kind: 'origin' });
    if (destination) list.push({ position: destination, label: '도착', kind: 'destination' });
    return list;
  }, [origin, destination]);

  async function handleCreate() {
    if (!me || !origin || !destination) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: me.id,
          nickname: me.nickname,
          origin: { lat: origin.lat, lng: origin.lng },
          originAddress: origin.address,
          destination: { lat: destination.lat, lng: destination.lng },
          destinationAddress: destination.address,
          departAt: new Date(departAt).toISOString(),
          capacity,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '방 생성에 실패했습니다');
      const data = json as CreateRoomResponse;
      router.push(`/rooms/${data.roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '방 생성에 실패했습니다');
    } finally {
      setCreating(false);
    }
  }

  const canCreate = Boolean(origin && destination && me && !creating);

  // 버튼이 왜 안 눌리는지 알려주지 않으면 "방이 안 만들어진다" 로 보인다.
  // 특히 검색창에 글자만 치고 목록에서 고르지 않으면 좌표가 없어 계속 막힌다.
  const blockedReason = creating
    ? null
    : !me
      ? '로그인 중입니다. 잠시만 기다려주세요.'
      : !origin
        ? '출발지를 검색 결과에서 선택하거나 지도를 눌러 지정하세요.'
        : !destination
          ? '도착지를 검색 결과에서 선택하거나 지도를 눌러 지정하세요.'
          : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4">
      <h1 className="text-xl font-bold tracking-tight">방 만들기</h1>

      <KakaoMap
        center={destination ?? origin ?? HUB}
        level={destination && origin ? 8 : 5}
        pins={pins}
        onPick={handleMapPick}
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
        <PlaceSearch
          label="출발"
          tone="emerald"
          value={origin}
          placeholder="출발지 검색 또는 지도 선택"
          onSelect={setOrigin}
        />
        <PlaceSearch
          label="도착"
          tone="rose"
          value={destination}
          placeholder="도착지 검색 또는 지도 선택"
          onSelect={setDestination}
        />

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

        <label className="flex items-center justify-between pt-1">
          <span className="text-slate-500 dark:text-slate-400">정원</span>
          <select
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}명
              </option>
            ))}
          </select>
        </label>
      </div>

      {(error ?? authError) && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error ?? authError}
        </p>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={!canCreate}
        className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        {creating ? '만드는 중…' : '방 만들기'}
      </button>

      {blockedReason && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">{blockedReason}</p>
      )}
    </main>
  );
}
