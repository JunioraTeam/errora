import { redirect } from "@/i18n/routing";

// Signup and login are merged into a single page — keep the old /register URL
// working by redirecting it to the unified auth screen.
export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/login", locale });
}
