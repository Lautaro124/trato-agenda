"use client";

import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { iniciales, useSession, type Usuario } from "@/lib/session";

/** Quién está logueado y cómo salir. */
export function SessionChip({ user }: { user: Usuario }) {
  const { signOut } = useSession();

  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-card py-1 pr-1 pl-1.5 shadow-sm">
      {user.avatarUrl ? (
        <Image
          src={user.avatarUrl}
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-7 place-items-center rounded-full bg-primary-subtle text-[11px] font-bold text-primary-hover">
          {iniciales(user)}
        </span>
      )}
      <span className="max-w-[180px] truncate text-[12.5px] text-ink">{user.email}</span>
      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
        Salir
      </Button>
    </div>
  );
}
