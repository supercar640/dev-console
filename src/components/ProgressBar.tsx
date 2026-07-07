// 진척도 막대(0–100). label 미지정 시 "NN%" 표시. 표시 전용 — 로직 없음.
export default function ProgressBar({
  percent,
  label
}: {
  percent: number
  label?: string
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__fill" style={{ width: `${clamped}%` }} />
      <span className="progress__label">{label ?? `${clamped}%`}</span>
    </div>
  )
}
