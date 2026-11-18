import { redirect } from "next/navigation";

/** Los chats ahora viven en Inicio: los enlaces viejos a /chats llevan ahí. */
export default function ChatsPage() {
  redirect("/inicio");
}
