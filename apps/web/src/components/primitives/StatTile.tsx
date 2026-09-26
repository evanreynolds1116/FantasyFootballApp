export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
    </div>
  );
}
