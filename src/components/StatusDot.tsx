import type { SessionStatus } from '@shared/types'
import { statusDotClass } from '@/stores/project-status'

export default function StatusDot({ status }: { status: SessionStatus | null }): React.JSX.Element {
  return <span className={`dot dot--${statusDotClass(status)}`} aria-hidden />
}
