import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ConsolidatedWarningBannerProps {
  warnings: {
    hashtabMismatch?: { hashtabVersion: string; firmwareVersion: string }
    timezoneMismatch?: { deviceTimezone: string; savedTimezone: string }
    osUpgrade?: { prevVersion: string; newVersion: string }
    autoUpdatesEnabled?: boolean
  }
  onGoToMaintenance: () => void
  onDismiss: () => void
}

export function ConsolidatedWarningBanner({
  warnings,
  onGoToMaintenance,
  onDismiss,
}: ConsolidatedWarningBannerProps) {
  const hasWarnings = warnings.osUpgrade || warnings.hashtabMismatch || warnings.timezoneMismatch || warnings.autoUpdatesEnabled

  if (!hasWarnings) return null

  return (
    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
        <ul className="text-sm space-y-1 list-disc pl-6">
          {warnings.osUpgrade && (
            <li>OS change detected ({warnings.osUpgrade.prevVersion} → {warnings.osUpgrade.newVersion}). Run reenable to restore mods.</li>
          )}
          {warnings.hashtabMismatch && (
            <li>Hashtable built for OS {warnings.hashtabMismatch.hashtabVersion}, but device is running {warnings.hashtabMismatch.firmwareVersion}</li>
          )}
          {warnings.timezoneMismatch && (
            <li>Device timezone ({warnings.timezoneMismatch.deviceTimezone}) differs from your preference ({warnings.timezoneMismatch.savedTimezone})</li>
          )}
          {warnings.autoUpdatesEnabled && (
            <li>Auto-updates are enabled and may interfere with mods</li>
          )}
        </ul>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button size="sm" onClick={onGoToMaintenance}>
          Maintenance
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
