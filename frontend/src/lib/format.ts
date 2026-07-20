export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDate(ts: number): string {
  const date = new Date(ts * 1000)
  const now = new Date()
  const isToday = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateFull(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function formatOsRange(p: {
  osConstraints?: { version: string; operator: string }[] | null
  osMin?: string | null
  osMax?: string | null
}): string | null {
  if (p.osConstraints && p.osConstraints.length > 0) {
    const minC = p.osConstraints.find(c => c.operator === '>=')
    const maxC = p.osConstraints.find(c => c.operator === '<')
    const exactC = p.osConstraints.find(c => c.operator === '=')

    if (exactC) return exactC.version

    if (minC && maxC) {
      const maxInclusive = (parseFloat(maxC.version) - 0.01).toFixed(2)
      return minC.version === maxInclusive ? minC.version : `${minC.version} – ${maxInclusive}`
    }

    if (minC) return `${minC.version}+`
    if (maxC) {
      const maxInclusive = (parseFloat(maxC.version) - 0.01).toFixed(2)
      return `≤ ${maxInclusive}`
    }
  }

  if (!p.osMin && !p.osMax) return null
  if (p.osMin && p.osMax) {
    const maxInclusive = (parseFloat(p.osMax) - 0.01).toFixed(2)
    return p.osMin === maxInclusive ? p.osMin : `${p.osMin} – ${maxInclusive}`
  }
  if (p.osMin) return `${p.osMin}+`
  if (p.osMax) {
    const maxInclusive = (parseFloat(p.osMax) - 0.01).toFixed(2)
    return `≤ ${maxInclusive}`
  }
  return null
}

export const STOCK_LAUNCHER = 'none'

export function launcherSelected(name: string): boolean {
  return name !== '' && name !== STOCK_LAUNCHER
}
