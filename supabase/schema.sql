-- ============================================================
-- taxi-share : 택시 동승 매칭/정산 플랫폼 스키마
-- Supabase Dashboard > SQL Editor 에 통째로 붙여넣고 RUN
-- 여러 번 실행해도 안전하도록 작성됨 (drop -> create)
-- ============================================================

-- 재실행 대비: 자식 테이블부터 정리
drop table if exists public.fare_segments cascade;
drop table if exists public.room_members  cascade;
drop table if exists public.rooms         cascade;
drop table if exists public.profiles      cascade;


-- ------------------------------------------------------------
-- 1) profiles : auth.users 와 1:1 로 붙는 사용자 정보
-- ------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null,
  student_id  text,                 -- 소속 정보. 지금은 받아만 두고 검증하지 않는다
  department  text,
  created_at  timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 2) rooms : 하나의 택시 = 하나의 방
--    방의 출발/도착은 "택시가 실제로 출발/도착하는 지점"
--    (개인별 승하차 지점은 room_members 에 따로 있음)
-- ------------------------------------------------------------
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.profiles(id) on delete cascade,

  origin_lat      double precision not null,
  origin_lng      double precision not null,
  origin_address  text not null,
  dest_lat        double precision not null,
  dest_lng        double precision not null,
  dest_address    text not null,

  depart_at     timestamptz not null,              -- 출발 희망 시각
  capacity      int  not null default 4 check (capacity between 2 and 4),
  status        text not null default 'open'
                check (status in ('open','locked','completed','cancelled')),

  -- 요금 모델을 방에 "스냅샷"으로 박아둔다.
  -- 나중에 요율을 바꿔도 과거 방의 정산 내역이 흔들리지 않게 하기 위함.
  base_fare     int not null default 4800,         -- 기본요금(원)
  per_km_fare   int not null default 760,          -- km 당 추가요금(원)
  night_surcharge_rate numeric not null default 0, -- 심야 할증 (0.2 = +20%)

  detour_tolerance numeric not null default 0.30,  -- 우회 허용 비율 (30%)

  total_distance_m int,                            -- 확정된 전체 경로 거리(m)
  total_fare       int,                            -- 확정된 총 택시비(원)

  created_at    timestamptz not null default now()
);

-- 매칭 후보 조회의 주 쿼리 경로: "모집중인 방을 출발시각 순으로"
create index rooms_status_depart_idx on public.rooms (status, depart_at);
-- 좌표 바운딩박스 선필터용 (PostGIS 없이 btree 로 충분한 규모)
create index rooms_origin_idx on public.rooms (origin_lat, origin_lng);
create index rooms_dest_idx   on public.rooms (dest_lat, dest_lng);


-- ------------------------------------------------------------
-- 3) room_members : 방 참가자 + "개인별" 승하차 지점
--    ★ 승하차 좌표가 rooms 가 아니라 여기 있는 것이 이 설계의 핵심.
--      사람마다 타고 내리는 지점이 달라야 구간별 분할 정산이 성립한다.
-- ------------------------------------------------------------
create table public.room_members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,

  pickup_lat       double precision not null,
  pickup_lng       double precision not null,
  pickup_address   text not null,
  dropoff_lat      double precision not null,
  dropoff_lng      double precision not null,
  dropoff_address  text not null,

  pickup_order   int,      -- 경유 순서 (1,2,3...) : 지도에 번호 마커로 표시
  dropoff_order  int,

  -- ★ 데모의 임팩트가 나오는 두 컬럼
  solo_fare    int,        -- 혼자 탔다면 냈을 요금
  final_fare   int,        -- 동승 후 실제 부담액
  -- 절약액 = solo_fare - final_fare (계산으로 나오므로 저장하지 않음)

  is_host      boolean not null default false,
  joined_at    timestamptz not null default now(),

  unique (room_id, user_id)          -- 한 방에 같은 사람 두 번 금지
);

create index room_members_room_idx on public.room_members (room_id);
create index room_members_user_idx on public.room_members (user_id);


-- ------------------------------------------------------------
-- 4) fare_segments : 정산 "근거" 저장
--    전체 경로를 승하차 이벤트로 자른 구간들.
--    각 구간 요금을 그 구간 탑승 인원수로 나눈 것이 분배 규칙.
--    -> 방 상세 화면의 정산 테이블이 이 테이블을 그대로 렌더링한다.
--       ("왜 내가 이 금액인지"를 보여주는 것이 심사 포인트)
-- ------------------------------------------------------------
create table public.fare_segments (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,

  seq           int  not null,            -- 구간 순서 (1부터)
  from_label    text not null,            -- 예: '출발지', 'B 승차'
  to_label      text not null,            -- 예: 'B 승차', 'A 하차'
  distance_m    int  not null,
  segment_fare  int  not null,            -- 이 구간에서 발생한 요금
  rider_count   int  not null check (rider_count > 0),
  per_person_fare int not null,           -- segment_fare / rider_count
  rider_ids     uuid[] not null default '{}',  -- 이 구간 탑승자들

  unique (room_id, seq)
);

create index fare_segments_room_idx on public.fare_segments (room_id, seq);


-- ------------------------------------------------------------
-- 5) 회원가입 시 profiles 자동 생성
--    이거 없으면 "로그인은 됐는데 프로필이 없다" 버그로 시간을 날린다.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', '익명' || substr(new.id::text, 1, 4))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ------------------------------------------------------------
-- 6) RLS  ※ 해커톤 데모 등급 ※
--    RLS 는 켜두되 정책은 느슨하게 열어둔다.
--    (끄면 Supabase 가 경고를 띄우고, 과하게 조이면 데모 중에 막힌다)
--    발표 때 "다음 단계: 정책 강화"로 언급하면 오히려 가점 요인.
-- ------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;
alter table public.fare_segments enable row level security;

-- 읽기: 전체 공개 (방 목록은 로그인 전에도 보여야 함)
create policy "demo read profiles"      on public.profiles      for select using (true);
create policy "demo read rooms"         on public.rooms         for select using (true);
create policy "demo read room_members"  on public.room_members  for select using (true);
create policy "demo read fare_segments" on public.fare_segments for select using (true);

-- 쓰기: 데모 기간 동안 전체 허용
-- TODO(발표 후): auth.uid() = user_id / host_id 로 조일 것
create policy "demo write profiles"      on public.profiles      for all using (true) with check (true);
create policy "demo write rooms"         on public.rooms         for all using (true) with check (true);
create policy "demo write room_members"  on public.room_members  for all using (true) with check (true);
create policy "demo write fare_segments" on public.fare_segments for all using (true) with check (true);


-- ------------------------------------------------------------
-- 7) Realtime : 누가 방에 들어오면 다른 사람 화면에 즉시 반영
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_members;


-- ============================================================
-- 데모 리셋용 (필요할 때 이 줄만 SQL Editor 에서 실행)
--   truncate public.fare_segments, public.room_members, public.rooms cascade;
-- ============================================================
