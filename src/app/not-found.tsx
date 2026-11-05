import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty">
      <h1>Page not found</h1>
      <p>Let’s get you back to your workspace.</p>
      <Link className="btn primary" href="/overview">
        Go to overview
      </Link>
    </main>
  );
}
