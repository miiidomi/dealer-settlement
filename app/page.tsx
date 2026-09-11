import SettlementApp from "./settlement-app";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] p-6 text-slate-950">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-[#175cd3] text-xl font-bold text-white">
            ₩
          </div>
          <h1 className="mt-5 text-2xl font-bold">딜러 정산 관리</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            링크로 공유받은 사용자는 ChatGPT 로그인 후 읽기 전용으로 확인할 수
            있습니다.
          </p>
          <a
            href={chatGPTSignInPath("/")}
            target="_top"
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#175cd3] px-5 text-sm font-semibold text-white hover:bg-[#124ba8]"
          >
            ChatGPT로 로그인
          </a>
        </section>
      </main>
    );
  return <SettlementApp />;
}
