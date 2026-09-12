import { createBrowserClient } from '@supabase/ssr';

/**
 * 브라우저용 Supabase 클라이언트.
 *
 * 여기서 쓰는 키는 publishable(구 anon) 키라 브라우저 노출이 정상이다.
 * 보호는 RLS 가 담당한다 — 정책을 조일 때 schema.sql 의 TODO 를 볼 것.
 */
export function createClient() {
  return createBrowserClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}

function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  // NEXT_PUBLIC_ 변수는 빌드 시점에 치환되므로 process.env[name] 같은 동적 접근은 통하지 않는다.
  const value =
    name === 'NEXT_PUBLIC_SUPABASE_URL'
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error(`${name} 가 없습니다. .env.local 을 확인하세요.`);
  return value;
}
