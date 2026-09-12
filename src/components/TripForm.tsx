'use client';

import { useEffect, useMemo, useState } from 'react';
import { KakaoMap, coordToAddress, type MapPin } from '@/components/KakaoMap';
import { PlaceSearch } from '@/components/PlaceSearch';
import { HUB, QUICK_PLACES, type Place } from '@/lib/places';
import type { LatLng } from '@/lib/types';

/**
 * 어디서 타고 어디서 내릴지 정하는 화면 조각.
 *
 * 출발지/도착지/시각 상태를 이 안에서 전부 들고 있고, 확정된 결과만 onSearch 로 넘긴다.
 * 바깥(page.tsx)은 GPS·지도 클릭·검색 같은 입력 방식을 알 필요가 없다.
 */

export type Trip = {
  origin: Place;
  destination: Place;
  /** ISO 문자열 */
  departAt: string;
};

type Props = {
  onSearch: (trip: Trip) => void;
  searching: boolean;
  /** 로그인 전에는 검색을 막는다 */
  disabled?: boolean;
};

export function TripForm({ onSearch, searching, disabled }: Props) {
  const [origin, setOrigin] = useState<Place | null>(HUB);
  const [destination, setDestination] = useState<Place | null>(null);
  /** 빠른 선택 칩과 지도 클릭이 어느 쪽을 채울지 */
  const [quickTarget, setQuickTarget] = useState<'origin' | 'destination'>('destination');
  /** 지금부터 몇 분 안에 출발할지. 심야 택시는 '언제'보다 '지금 곧'이 현실적이다. */
  const [withinMin, setWithinMin] = useState<10 | 30>(30);

  const [locating, setLocating] = useState(true);
  /** 출발지가 GPS 에서 온 것인지. 지도에서 직접 찍으면 false 가 된다. */
  const [originFromGps, setOriginFromGps] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // 첫 진입 시 현재 위치를 출발지로 잡는다.
  // 실패해도 HUB 가 기본값이라 화면은 그대로 쓸 수 있다.
  useEffect(() => {
    locate({ silent: true });
    // 최초 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate({ silent }: { silent: boolean }) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocating(false);
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        // 주소 변환은 지도 SDK 로딩을 기다릴 수 있어 마커부터 먼저 찍는다.
        setOrigin({ ...point, address: '현재 위치' });
        setOriginFromGps(true);
        setLocating(false);
        const address = await coordToAddress(point);
        setOrigin({ ...point, address });
      },
      () => {
        // 권한 거부 / 타임아웃 / 안전하지 않은 컨텍스트.
        // 첫 진입에 에러를 띄우면 데모가 어색해지므로 조용히 넘어간다.
        setLocating(false);
        if (!silent) setLocateError('현재 위치를 가져오지 못했습니다. 지도를 눌러 직접 선택해주세요.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  function pickOrigin(place: Place) {
    setOrigin(place);
    setOriginFromGps(false);
  }

  async function handleMapPick(point: LatLng) {
    const place: Place = { ...point, address: await coordToAddress(point) };
    if (quickTarget === 'origin') pickOrigin(place);
    else setDestination(place);
  }

  /** 빠른 선택 칩. 지도 클릭과 같은 대상(출발/도착)을 채운다. */
  function pickQuick(place: Place) {
    if (quickTarget === 'origin') pickOrigin(place);
    else setDestination(place);
  }

  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (origin) {
      list.push({ position: origin, label: originFromGps ? '내 위치' : '출발', kind: 'origin' });
    }
    if (destination) list.push({ position: destination, label: '도착', kind: 'destination' });
    return list;
  }, [origin, destination, originFromGps]);

  const canSearch = Boolean(origin && destination && !searching && !disabled);

  // 버튼이 왜 비활성인지 알려준다. 검색창에 글자만 치고 목록에서 고르지 않으면
  // 좌표가 잡히지 않아 계속 막히는데, 안내가 없으면 "동작을 안 한다" 로 보인다.
  const blockedReason = searching
    ? null
    : disabled
      ? '로그인 중입니다. 잠시만 기다려주세요.'
      : !origin
        ? '출발지를 검색 결과에서 선택하거나 지도를 눌러 지정하세요.'
        : !destination
          ? '도착지를 검색 결과에서 선택하거나 지도를 눌러 지정하세요.'
          : null;

  return (
    <>
      <KakaoMap
        center={destination ?? origin ?? HUB}
        level={destination && origin ? 8 : 5}
        pins={pins}
        onPick={handleMapPick}
        className="h-64 w-full ring-1 ring-black/5"
      />

      <p className="text-xs text-slate-400 dark:text-slate-500">
        지도를 누르거나 아래 장소를 고르면 {quickTarget === 'origin' ? '출발지' : '도착지'}가 채워집니다.
      </p>

      <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900">
        <PlaceSearch
          label="출발"
          tone="emerald"
          value={origin}
          pendingText={locating ? '현재 위치 확인 중…' : undefined}
          placeholder="출발지 검색 또는 지도 선택"
          onSelect={pickOrigin}
        />
        <PlaceSearch
          label="도착"
          tone="rose"
          value={destination}
          placeholder="도착지 검색 또는 지도 선택"
          onSelect={setDestination}
        />

        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-slate-400">빠른 선택</span>
          <div className="flex overflow-hidden rounded-full ring-1 ring-slate-200 dark:ring-slate-700">
            {(['origin', 'destination'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setQuickTarget(t)}
                className={`px-2.5 py-1 text-xs font-medium transition ${
                  quickTarget === t
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-white text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {t === 'origin' ? '출발' : '도착'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => locate({ silent: false })}
            disabled={locating}
            className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900"
          >
            {locating ? '확인 중…' : '내 위치'}
          </button>
          {QUICK_PLACES.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => pickQuick(p)}
              className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
            >
              {p.address}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <span className="text-slate-500 dark:text-slate-400">출발</span>
          <div className="flex gap-1.5">
            {([10, 30] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setWithinMin(m)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  withinMin === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'
                }`}
              >
                {m}분 내
              </button>
            ))}
          </div>
        </div>
      </div>

      {locateError && <p className="text-xs text-slate-500 dark:text-slate-400">{locateError}</p>}

      <button
        type="button"
        onClick={() => {
          if (!origin || !destination) return;
          // 버튼을 누른 시점 기준으로 계산해야 화면을 오래 켜둬도 시각이 밀리지 않는다
          onSearch({
            origin,
            destination,
            departAt: new Date(Date.now() + withinMin * 60_000).toISOString(),
          });
        }}
        disabled={!canSearch}
        className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        {searching ? '경로 계산 중…' : '동승 가능한 택시 찾기'}
      </button>

      {blockedReason && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">{blockedReason}</p>
      )}
    </>
  );
}
