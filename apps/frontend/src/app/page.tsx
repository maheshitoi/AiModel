import { SystemStatus } from "@/components/system-status";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">My Own AI</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Self-trained language model · WhatsApp automation · Management dashboard
      </p>
      <h2 className="mt-10 mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">System status</h2>
      <SystemStatus />
    </main>
  );
}
