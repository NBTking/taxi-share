import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * 서버용 Supabase 클라이언트 (Route Handler / Server Component).
 *
 * Next 16 의 cookies() 는 async 이므로 이 함수도 async 다.
 * 호출부에서 await 를 빠뜨리면 조용히 인증 없는 요청이 나가니 주의할 것.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component 에서는 쿠키를 쓸 수 없다.
            // 세션 갱신은 미들웨어/Route Handler 가 담당하므로 여기서는 무시해도 된다.
          }
        },
      },
    },
  );
}
