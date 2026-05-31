import type { PermissionRequest } from '@shared/types'

export default function PermissionCard({
  req, onApprove, onDeny
}: {
  req: PermissionRequest
  onApprove: () => void
  onDeny: () => void
}): React.JSX.Element {
  const title = req.kind === 'question' ? '질문 — 답이 필요합니다' : `승인 필요 — ${req.toolName}`
  return (
    <div className="perm-card">
      <div className="perm-card__title">⚠️ {title}</div>
      <code className="perm-card__detail">{JSON.stringify(req.input)}</code>
      <div className="perm-card__actions">
        <button className="btn btn--primary" onClick={onApprove}>승인</button>
        <button className="btn btn--danger" onClick={onDeny}>거부</button>
      </div>
    </div>
  )
}
