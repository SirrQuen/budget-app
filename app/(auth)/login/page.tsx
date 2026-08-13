import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const initialError =
    params.error === "confirmation_failed"
      ? "That confirmation link is invalid or has expired."
      : undefined;

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Log in</h1>
      <LoginForm initialError={initialError} />
    </>
  );
}
