export default function UsageMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="usage-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
