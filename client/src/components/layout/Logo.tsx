import { usePublicConfig } from '@/lib/queries';

export function Logo({ compact }: { compact?: boolean }) {
  const { data } = usePublicConfig();
  const name = String(data?.['general.siteName'] ?? 'KinoBox');
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-brand shadow-lg shadow-accent/30">
        <svg viewBox="0 0 24 24" className="ml-0.5 size-4 fill-white" aria-hidden>
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
      </span>
      {!compact && <span className="text-lg font-extrabold tracking-tight">{name}</span>}
    </span>
  );
}
