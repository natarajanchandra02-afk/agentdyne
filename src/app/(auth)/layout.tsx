// Layout for all (auth) route group pages:
// /login, /signup, /forgot-password
// Keeps auth pages clean with no extra chrome.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
