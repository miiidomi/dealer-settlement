"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSessionLifecycle, type SessionState } from "./session-lifecycle";

const LogoutContext = createContext<() => void>(() => {});

export function LogoutButton() {
  const logout = useContext(LogoutContext);
  return <Button type="button" variant="outline" onClick={logout}><LogOut className="size-4" />로그아웃</Button>;
}

export function SessionGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>("checking");
  const lifecycle = useRef<ReturnType<typeof createSessionLifecycle> | null>(null);
  // Keep the current page mounted during routine validation so filters and dialogs
  // survive a tab switch, but remove it completely after logout or verification failure.
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    const controller = createSessionLifecycle(window, (next) => {
      setState(next);
      if (next === "active") setHasSession(true);
      if (next === "signed-out" || next === "unavailable") setHasSession(false);
    });
    lifecycle.current = controller;
    return () => { controller.dispose(); lifecycle.current = null; };
  }, []);
  return <LogoutContext.Provider value={() => lifecycle.current?.logout()}>
    {hasSession && <div className="session-protected">{children}</div>}
    {state !== "active" && <main className="session-status fixed inset-0 z-[100] grid place-items-center bg-[#f4f7fb] p-6 text-slate-950">
      <section className="max-w-md text-center" role="status">
        <h1 className="text-xl font-bold">{state === "checking" ? "로그인 확인 중…" : state === "signed-out" ? "로그아웃되었습니다." : "로그인 상태를 확인할 수 없습니다."}</h1>
        {state !== "checking" && <div className="mt-5 flex justify-center gap-2">
          {state === "unavailable" && <Button variant="outline" onClick={() => void lifecycle.current?.retry()}>다시 확인</Button>}
          <Button onClick={() => window.location.replace("/")}>다시 로그인</Button>
          {state === "unavailable" && <LogoutButton />}
        </div>}
      </section>
    </main>}
  </LogoutContext.Provider>;
}
