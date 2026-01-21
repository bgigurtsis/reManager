import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, AlertTriangle } from 'lucide-react'
import { TerminalWithCopy } from '@/components/TerminalWithCopy'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isConnected: boolean
  vellumInstalled: boolean | null
  tabVisibility: Record<string, boolean>
  proxyMode: boolean
  suppressSystemFileWarnings: boolean
  onSaveSettings: (tabVisibility: Record<string, boolean>, proxyMode: boolean, suppressSystemFileWarnings: boolean) => void
  onUninstallVellum: (removeAllPackages: boolean) => void
  uninstalling: boolean
  uninstallOutput: string
  appVersion: string
}

export function SettingsDialog({
  open,
  onOpenChange,
  isConnected,
  vellumInstalled,
  tabVisibility,
  proxyMode,
  suppressSystemFileWarnings,
  onSaveSettings,
  onUninstallVellum,
  uninstalling,
  uninstallOutput,
  appVersion,
}: SettingsDialogProps) {
  const defaultTabVisibility = { mods: true, maintenance: true, utilities: true }

  const [localTabVisibility, setLocalTabVisibility] = useState({ ...defaultTabVisibility, ...tabVisibility })
  const [localProxyMode, setLocalProxyMode] = useState(proxyMode)
  const [localSuppressSystemFileWarnings, setLocalSuppressSystemFileWarnings] = useState(suppressSystemFileWarnings)
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false)
  const [removePackages, setRemovePackages] = useState(true)

  const hasChanges =
    localProxyMode !== proxyMode ||
    localSuppressSystemFileWarnings !== suppressSystemFileWarnings ||
    JSON.stringify(localTabVisibility) !== JSON.stringify({ ...defaultTabVisibility, ...tabVisibility })

  useEffect(() => {
    if (open) {
      setLocalTabVisibility({ ...defaultTabVisibility, ...tabVisibility })
      setLocalProxyMode(proxyMode)
      setLocalSuppressSystemFileWarnings(suppressSystemFileWarnings)
    }
  }, [open, tabVisibility, proxyMode, suppressSystemFileWarnings])

  const handleCancel = () => {
    setLocalTabVisibility({ ...defaultTabVisibility, ...tabVisibility })
    setLocalProxyMode(proxyMode)
    setLocalSuppressSystemFileWarnings(suppressSystemFileWarnings)
    setShowUninstallConfirm(false)
    onOpenChange(false)
  }

  const handleSave = () => {
    onSaveSettings(localTabVisibility, localProxyMode, localSuppressSystemFileWarnings)
    onOpenChange(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setShowUninstallConfirm(false)
      setLocalTabVisibility({ ...defaultTabVisibility, ...tabVisibility })
      setLocalProxyMode(proxyMode)
      setLocalSuppressSystemFileWarnings(suppressSystemFileWarnings)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[80vw] h-[80vh] max-w-none flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure reManager preferences
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 flex-1 overflow-y-auto">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Tab Visibility</CardTitle>
              <CardDescription className="text-xs">
                Choose which tabs to show in the app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="tab-mods" className="font-normal">Mods</Label>
                <Switch
                  id="tab-mods"
                  checked={localTabVisibility.mods}
                  onCheckedChange={(v) => setLocalTabVisibility({ ...localTabVisibility, mods: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="tab-utilities" className="font-normal">Utilities</Label>
                <Switch
                  id="tab-utilities"
                  checked={localTabVisibility.utilities}
                  onCheckedChange={(v) => setLocalTabVisibility({ ...localTabVisibility, utilities: v })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Behavior</CardTitle>
              <CardDescription className="text-xs">
                Configure how reManager operates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="proxy-mode" className="font-normal">Proxy Mode</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Download packages through reManager before installing on the tablet.
                    Useful if the tablet has limited internet connectivity.
                  </p>
                </div>
                <Switch
                  id="proxy-mode"
                  checked={localProxyMode}
                  onCheckedChange={setLocalProxyMode}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="suppress-sys-warnings" className="font-normal">Suppress System Warnings</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Skip confirmation dialogs when modifying system partition files.
                    Only disable if you are experienced with Linux systems.
                  </p>
                </div>
                <Switch
                  id="suppress-sys-warnings"
                  checked={localSuppressSystemFileWarnings}
                  onCheckedChange={setLocalSuppressSystemFileWarnings}
                />
              </div>
            </CardContent>
          </Card>

          {isConnected && vellumInstalled && (
            <Card className="border-destructive/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Uninstall</CardTitle>
                <CardDescription className="text-xs">
                  Remove the Vellum package manager from your reMarkable.
                  <br />
                  reManager will no longer be able to install or manage packages unless Vellum is reinstalled.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {uninstalling ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Uninstalling Vellum...</span>
                    </div>
                    {uninstallOutput && (
                      <div className="h-[200px] rounded-lg overflow-hidden">
                        <TerminalWithCopy output={uninstallOutput} />
                      </div>
                    )}
                  </div>
                ) : !showUninstallConfirm ? (
                  <Button
                    variant="outline"
                    onClick={() => setShowUninstallConfirm(true)}
                    className="w-full"
                  >
                    Uninstall Vellum
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <span>This will remove Vellum from the device</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="remove-pkgs" className="font-normal text-sm">
                        Also remove all installed packages
                      </Label>
                      <Switch
                        id="remove-pkgs"
                        checked={removePackages}
                        onCheckedChange={setRemovePackages}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowUninstallConfirm(false)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => onUninstallVellum(removePackages)}
                        className="flex-1"
                      >
                        Confirm Uninstall
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 mt-4">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges}>
            Save
          </Button>
        </DialogFooter>

        <div className="flex-shrink-0 text-sm text-muted-foreground text-center pt-2">
          <span>reManager {appVersion}</span>
          <span className="mx-2">·</span>
          <button
            onClick={() => window.runtime.BrowserOpenURL('https://github.com/rmitchellscott/remanager')}
            className="hover:underline"
          >
            GitHub
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
