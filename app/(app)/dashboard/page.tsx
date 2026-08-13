import { requireUser } from "@/lib/auth/dal";
import { logout } from "@/lib/auth/actions";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Logged in as</p>
      <p className="text-lg font-medium">{user.email}</p>
      <form action={logout}>
        <button
          type="submit"
          className="mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
