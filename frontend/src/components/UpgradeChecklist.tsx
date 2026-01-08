import { AlertTriangle, Loader2, Trash2, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

interface UpgradeChecklistProps {
  storedOsVersion: string
  currentOsVersion: string
  compatiblePackages: string[]
  incompatiblePackages: string[]
  loading?: boolean
  fetchFailed?: boolean
  uninstallQueue: Set<string>
  onAddToUninstallQueue: (pkg: string) => void
  onRemoveFromUninstallQueue: (pkg: string) => void
  onRunUpgrade: () => void
  onRunReenable: () => void
}

export function UpgradeChecklist({
  storedOsVersion,
  currentOsVersion,
  compatiblePackages,
  incompatiblePackages,
  loading = false,
  fetchFailed = false,
  uninstallQueue,
  onAddToUninstallQueue,
  onRemoveFromUninstallQueue,
  onRunUpgrade,
  onRunReenable,
}: UpgradeChecklistProps) {
  const canUpgrade = incompatiblePackages.length === 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <CardTitle>OS Change Detected</CardTitle>
        </div>
        <CardDescription>
          Your reMarkable OS has changed from {storedOsVersion} to {currentOsVersion}.
          Review package compatibility and complete the upgrade process.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {fetchFailed && (
          <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
            Could not verify package compatibility (offline?). Showing all installed packages.
          </div>
        )}

        <Accordion type="multiple" defaultValue={["incompatible"]}>
          {compatiblePackages.length > 0 && (
            <AccordionItem value="compatible" className="border-none">
              <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline">
                Compatible Packages ({compatiblePackages.length})
              </AccordionTrigger>
              <AccordionContent>
                <div className="border rounded-md divide-y">
                  {compatiblePackages.map(pkg => (
                    <div key={pkg} className="px-3 py-2 text-sm flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      <span>{pkg}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {incompatiblePackages.length > 0 && (
            <AccordionItem value="incompatible" className="border-none">
              <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline">
                Incompatible Packages ({incompatiblePackages.length})
              </AccordionTrigger>
              <AccordionContent>
                <div className="border rounded-md divide-y overflow-hidden">
                  {incompatiblePackages.map((pkg, index) => {
                    const isQueued = uninstallQueue.has(pkg)
                    const prevQueued = index > 0 && uninstallQueue.has(incompatiblePackages[index - 1])
                    const nextQueued = index < incompatiblePackages.length - 1 && uninstallQueue.has(incompatiblePackages[index + 1])
                    return (
                      <div
                        key={pkg}
                        className={`px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                          isQueued
                            ? `border-l-4 border-destructive ${!prevQueued ? 'border-t border-t-destructive' : ''} ${!nextQueued ? 'border-b border-b-destructive' : ''}`
                            : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <X className="h-4 w-4 text-destructive" />
                          <span>{pkg}</span>
                        </div>
                        {isQueued ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onRemoveFromUninstallQueue(pkg)}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Queued
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onAddToUninstallQueue(pkg)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Uninstall
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>

        <div className="space-y-3 pt-4 border-t">
          <div className="text-sm font-medium">Actions</div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onRunReenable} disabled={loading}>
              Run Reenable
            </Button>

            <div className="flex-1" />

            <Button
              onClick={onRunUpgrade}
              disabled={!canUpgrade || loading}
              title={!canUpgrade ? 'Uninstall incompatible packages first' : undefined}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                'Run Upgrade'
              )}
            </Button>
          </div>

          {!canUpgrade && (
            <p className="text-sm text-muted-foreground">
              Uninstall incompatible packages before running upgrade.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
