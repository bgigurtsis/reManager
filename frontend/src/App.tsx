import { useState, useEffect, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ProgressModal } from '@/components/ProgressModal'
import { PackageDetailPanel } from '@/components/PackageDetailPanel'
import { NotificationBanner } from '@/components/NotificationBanner'
import { UpgradeChecklist } from '@/components/UpgradeChecklist'
import { VellumInstallPrompt } from '@/components/VellumInstallPrompt'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Loader2, Unplug, Check, AlertTriangle, Trash2, Plus, X, Search, ChevronDown, Settings } from 'lucide-react'

interface PackageInfo {
  name: string
  version: string
  description: string
  upstreamAuthor: string
  category: string
  url: string
  license: string
  devices: string[]
  depends: string[]
  conflicts: string[]
  osMin: string | null
  osMax: string | null
}

interface MaintenanceCommandInfo {
  id: string
  label: string
  description: string
  requiresTerminal: boolean
  allowStop: boolean
  hook?: string
}

interface SystemTaskInfo {
  id: string
  label: string
  description: string
  requiresTerminal: boolean
  needsWriteableRoot: boolean
}

interface SSHKey {
  path: string
  name: string
}

interface SavedDevice {
  id: string
  name: string
  host: string
  authType: 'password' | 'key'
  keyPath?: string
  lastConnected?: number
}

interface UpdateServiceStatus {
  enabled: boolean
  running: boolean
}

interface InstallProgress {
  component: string
  index: number
  total: number
  status: string
  message: string
}

interface InstallResult {
  success: boolean
  errors: string[]
}

interface DialogRequest {
  title: string
  message: string
  steps: string[]
  confirmText: string
  inProgressMessage: string
}

interface InstallSimulationResult {
  packages: string[]
  requested: string[]
}

interface UninstallSimulationResult {
  packages: string[]
  blocked: Record<string, string[]> | null
  recursivePackages: string[] | null
}

interface InstalledPackagesResult {
  packages: string[]
  osUpgraded: boolean
  prevVersion: string
  newVersion: string
}

interface HashtabVersionStatus {
  installed: boolean
  hashtabVersion: string
  firmwareVersion: string
  needsRebuild: boolean
}

declare global {
  interface Window {
    go: {
      main: {
        App: {
          Connect(host: string, password: string): Promise<{ success: boolean; message: string; device?: string }>
          ConnectWithKey(host: string, keyPath: string, passphrase: string): Promise<{ success: boolean; message: string; device?: string }>
          CancelConnect(): Promise<void>
          Disconnect(): Promise<void>
          IsConnected(): Promise<boolean>
          RunCommand(cmd: string): Promise<string>
          RunCommandWithOutput(cmd: string, requiresPTY: boolean): Promise<void>
          StopCommand(): Promise<void>
          GetDeviceInfo(): Promise<Record<string, string>>
          GetUpdateServiceStatus(): Promise<UpdateServiceStatus>
          GetDefaultSSHKeys(): Promise<SSHKey[]>
          SelectKeyFile(): Promise<string>
          GetSavedDevices(): Promise<SavedDevice[]>
          SaveDevice(id: string, name: string, host: string, authType: string, password: string, keyPath: string, keyPassphrase: string): Promise<string>
          DeleteSavedDevice(id: string): Promise<void>
          ConnectToSavedDevice(id: string): Promise<{ success: boolean; message: string; device?: string }>
          UpdateDeviceName(id: string, name: string): Promise<void>
          CheckVellumInstalled(): Promise<boolean>
          BootstrapVellum(): Promise<void>
          CheckPackageInstalled(pkgName: string): Promise<boolean>
          CheckHashtabVersion(): Promise<HashtabVersionStatus>
          GetPackages(): Promise<PackageInfo[]>
          GetInstalledPackages(): Promise<string[]>
          GetInstalledPackagesWithOsCheck(): Promise<InstalledPackagesResult>
          RunReenable(): Promise<void>
          RunUpgrade(): Promise<void>
          GetPackageCompatibilityStatus(): Promise<{
            installedPackages: string[]
            compatiblePackages: string[]
            incompatiblePackages: string[]
            currentOsVersion: string
            storedOsVersion: string
            fetchFailed: boolean
          }>
          GetMaintenanceCommands(pkgName: string): Promise<MaintenanceCommandInfo[]>
          GetSystemTasksInfo(): Promise<SystemTaskInfo[]>
          GetDeviceDisplayName(machine: string): Promise<string>
          GetDeviceArchitecture(deviceType: string): Promise<string>
          InstallPackages(packageNames: string[], deviceType: string): Promise<void>
          UninstallPackages(packageNames: string[], deviceType: string): Promise<void>
          SimulateInstall(packageNames: string[], deviceType: string): Promise<InstallSimulationResult>
          SimulateUninstall(packageNames: string[]): Promise<UninstallSimulationResult>
          RunMaintenanceCommand(pkgName: string, commandId: string, deviceType: string): Promise<void>
          RunSystemTask(taskId: string, deviceType: string): Promise<void>
          RespondToDialog(confirmed: boolean): Promise<void>
          GetAppVersion(): Promise<string>
          GetSettings(): Promise<{ tabVisibility: Record<string, boolean> }>
          SaveSettings(tabVisibility: Record<string, boolean>): Promise<void>
          UninstallVellum(removeAllPackages: boolean): Promise<void>
        }
      }
    }
    runtime: {
      EventsOn(eventName: string, callback: (...args: unknown[]) => void): () => void
      BrowserOpenURL(url: string): void
    }
  }
}

type Step = 'connect' | 'select' | 'install' | 'done'

export default function App() {
  const [step, setStep] = useState<Step>('connect')
  const [host, setHost] = useState('10.11.99.1')
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [password, setPassword] = useState('')
  const [availableKeys, setAvailableKeys] = useState<SSHKey[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [customKeyName, setCustomKeyName] = useState<string>('')
  const [keyPassphrase, setKeyPassphrase] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<string>('')
  const [deviceInfo, setDeviceInfo] = useState<Record<string, string>>({})
  const [installedPackages, setInstalledPackages] = useState<Set<string>>(new Set())
  const [vellumInstalled, setVellumInstalled] = useState<boolean | null>(null)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapOutput, setBootstrapOutput] = useState('')
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [output, setOutput] = useState('')
  const [currentComponent, setCurrentComponent] = useState('')
  const [showRebuildDialog, setShowRebuildDialog] = useState(false)
  const [dialogRequest, setDialogRequest] = useState<DialogRequest | null>(null)
  const connectAttemptRef = useRef(0)

  const [activeTab, setActiveTab] = useState<'mods' | 'maintenance'>('mods')
  const [installQueue, setInstallQueue] = useState<Set<string>>(new Set())
  const [uninstallQueue, setUninstallQueue] = useState<Set<string>>(new Set())
  const [pendingUninstall, setPendingUninstall] = useState<{
    componentIds: string[]
    componentNames: string[]
    dependents: Array<{ id: string; name: string }>
  } | null>(null)
  const [pendingOrphanRemoval, setPendingOrphanRemoval] = useState<{
    itemToRemove: string
    orphans: Array<{ id: string; name: string }>
  } | null>(null)
  const [uninstalling, setUninstalling] = useState(false)
  const [maintenanceOutput, setMaintenanceOutput] = useState('')
  const [commandRunning, setCommandRunning] = useState(false)
  const [currentRunningCommand, setCurrentRunningCommand] = useState<{
    componentId: string
    commandId: string
  } | null>(null)
  const [updateServiceStatus, setUpdateServiceStatus] = useState<UpdateServiceStatus>({
    enabled: false,
    running: false,
  })
  const [showAutoUpdateBanner, setShowAutoUpdateBanner] = useState(false)
  const [commandContext, setCommandContext] = useState<'install' | 'maintenance' | null>(null)
  const commandContextRef = useRef<'install' | 'maintenance' | null>(null)

  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [appVersion, setAppVersion] = useState('dev')
  const [tabVisibility, setTabVisibility] = useState<Record<string, boolean>>({
    mods: true,
    maintenance: true,
  })
  const [vellumUninstalling, setVellumUninstalling] = useState(false)
  const [vellumUninstallOutput, setVellumUninstallOutput] = useState('')

  const [showProgressModal, setShowProgressModal] = useState(false)
  const [progressModalType, setProgressModalType] = useState<'install' | 'maintenance' | null>(null)
  const [progressIndex, setProgressIndex] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressPercentage, setProgressPercentage] = useState(0)

  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [systemTasks, setSystemTasks] = useState<SystemTaskInfo[]>([])
  const [maintenanceCommands, setMaintenanceCommands] = useState<Record<string, MaintenanceCommandInfo[]>>({})

  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [showSaveDeviceDialog, setShowSaveDeviceDialog] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null)
  const [editingDevice, setEditingDevice] = useState<SavedDevice | null>(null)
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [lastInstallSuccess, setLastInstallSuccess] = useState<boolean | null>(null)
  const [lastOperationType, setLastOperationType] = useState<'install' | 'uninstall' | null>(null)
  const [installedExpanded, setInstalledExpanded] = useState(true)
  const [availableExpanded, setAvailableExpanded] = useState(true)
  const [selectedPackage, setSelectedPackage] = useState<PackageInfo | null>(null)
  const [installQueueExpanded, setInstallQueueExpanded] = useState(false)
  const [uninstallQueueExpanded, setUninstallQueueExpanded] = useState(false)
  const [pendingInstallConfirm, setPendingInstallConfirm] = useState<{
    packages: string[]
    requested: string[]
  } | null>(null)
  const [pendingUninstallConfirm, setPendingUninstallConfirm] = useState<{
    selected: string[]
    packages: string[]
    blocked: Record<string, string[]> | null
    useRecursive: boolean
  } | null>(null)
  const [simulatingInstall, setSimulatingInstall] = useState(false)
  const [simulatingUninstall, setSimulatingUninstall] = useState(false)

  // OS upgrade detection state (reactive - from vellum list)
  const [osUpgradeDetected, setOsUpgradeDetected] = useState(false)
  const [prevOsVersion, setPrevOsVersion] = useState('')
  const [newOsVersion, setNewOsVersion] = useState('')
  const [runningReenable, setRunningReenable] = useState(false)

  // OS mismatch detection state (proactive - at connection time)
  const [osMismatchDetected, setOsMismatchDetected] = useState(false)
  const [storedOsVersion, setStoredOsVersion] = useState('')
  const [currentOsVersion, setCurrentOsVersion] = useState('')
  const [checklistLoading, setChecklistLoading] = useState(false)
  const [compatibilityStatus, setCompatibilityStatus] = useState<{
    installedPackages: string[]
    compatiblePackages: string[]
    incompatiblePackages: string[]
    currentOsVersion: string
    storedOsVersion: string
    fetchFailed: boolean
  } | null>(null)

  // Hashtab version mismatch state
  const [hashtabMismatch, setHashtabMismatch] = useState<HashtabVersionStatus | null>(null)

  // Filter state for mod list
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Memoized sorted and filtered packages
  const categories = useMemo(() => {
    const cats = new Set(packages.map(p => p.category).filter(Boolean))
    return Array.from(cats).sort()
  }, [packages])

  const compareVersions = (a: string, b: string): number => {
    const aParts = a.split('.').map(p => parseInt(p.split('-')[0], 10) || 0)
    const bParts = b.split('.').map(p => parseInt(p.split('-')[0], 10) || 0)
    const maxLen = Math.max(aParts.length, bParts.length)
    for (let i = 0; i < maxLen; i++) {
      const aNum = aParts[i] || 0
      const bNum = bParts[i] || 0
      if (aNum > bNum) return 1
      if (aNum < bNum) return -1
    }
    return 0
  }

  const isPackageCompatible = (pkg: PackageInfo, osVersion: string): boolean => {
    if (!osVersion) return true
    if (pkg.osMin && compareVersions(osVersion, pkg.osMin) < 0) return false
    if (pkg.osMax && compareVersions(osVersion, pkg.osMax) >= 0) return false
    return true
  }

  const filteredPackages = useMemo(() => {
    const firmware = deviceInfo.firmware || ''
    return [...packages]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .filter(pkg => {
        if (!isPackageCompatible(pkg, firmware)) {
          return false
        }
        if (search && !pkg.name.toLowerCase().includes(search.toLowerCase()) &&
            !pkg.description.toLowerCase().includes(search.toLowerCase())) {
          return false
        }
        if (categoryFilter !== 'all' && pkg.category !== categoryFilter) {
          return false
        }
        return true
      })
  }, [packages, search, categoryFilter, deviceInfo.firmware])

  const installedFiltered = useMemo(() =>
    filteredPackages.filter(pkg => installedPackages.has(pkg.name)),
    [filteredPackages, installedPackages]
  )

  const availableFiltered = useMemo(() =>
    filteredPackages.filter(pkg => !installedPackages.has(pkg.name)),
    [filteredPackages, installedPackages]
  )

  useEffect(() => {
    commandContextRef.current = commandContext
  }, [commandContext])

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        console.log('[DEBUG] loadInitialData: starting')
        const [keys, pkgs, tasks, devices, version, settings] = await Promise.all([
          window.go.main.App.GetDefaultSSHKeys(),
          window.go.main.App.GetPackages(),
          window.go.main.App.GetSystemTasksInfo(),
          window.go.main.App.GetSavedDevices(),
          window.go.main.App.GetAppVersion(),
          window.go.main.App.GetSettings(),
        ])
        console.log('[DEBUG] loadInitialData: got pkgs', pkgs?.length, pkgs)

        setAvailableKeys(keys || [])
        if (keys && keys.length > 0) {
          setSelectedKey(keys[0].path)
        } else {
          setSelectedKey('__other__')
        }

        setPackages(pkgs || [])
        setSystemTasks(tasks || [])
        setSavedDevices(devices || [])
        setAppVersion(version || 'dev')
        setTabVisibility(settings?.tabVisibility || { mods: true, maintenance: true })
      } catch (err) {
        console.log('Could not load initial data:', err)
        setSelectedKey('__other__')
      }
    }
    loadInitialData()
  }, [])

  useEffect(() => {
    if (activeTab === 'maintenance' && step !== 'connect') {
      fetchUpdateServiceStatus()
    }
  }, [activeTab, step])

  useEffect(() => {
    if (activeTab === 'mods' && !tabVisibility.mods) {
      setActiveTab('maintenance')
    }
  }, [tabVisibility.mods, activeTab])

  const handleKeySelect = async (value: string) => {
    if (value === '__other__') {
      const path = await window.go.main.App.SelectKeyFile()
      if (path) {
        setSelectedKey(path)
        const fileName = path.split('/').pop() || path
        setCustomKeyName(fileName)
      }
    } else {
      setSelectedKey(value)
      setCustomKeyName('')
    }
  }

  const handleConnectToSavedDevice = async (id: string) => {
    const thisAttempt = ++connectAttemptRef.current
    setConnecting(true)
    setConnectingDeviceId(id)
    setError('')

    try {
      const result = await window.go.main.App.ConnectToSavedDevice(id)

      if (thisAttempt !== connectAttemptRef.current) return

      if (result.success) {
        const info = await window.go.main.App.GetDeviceInfo()
        setDevice(result.device || 'unknown')
        setDeviceInfo(info)

        console.log('[DEBUG] handleConnectToSavedDevice: calling GetInstalledPackagesWithOsCheck')
        const installedResult = await window.go.main.App.GetInstalledPackagesWithOsCheck()
        console.log('[DEBUG] handleConnectToSavedDevice: result =', installedResult)
        setInstalledPackages(new Set(installedResult.packages || []))
        if (installedResult.osUpgraded) {
          setOsUpgradeDetected(true)
          setPrevOsVersion(installedResult.prevVersion)
          setNewOsVersion(installedResult.newVersion)
        }

        const maintCmds: Record<string, MaintenanceCommandInfo[]> = {}
        for (const pkg of packages) {
          const cmds = await window.go.main.App.GetMaintenanceCommands(pkg.name)
          if (cmds && cmds.length > 0) {
            maintCmds[pkg.name] = cmds
          }
        }
        setMaintenanceCommands(maintCmds)
        setStep('select')
      } else {
        setError(result.message)
      }
    } catch (err) {
      if (thisAttempt !== connectAttemptRef.current) return
      setError(String(err))
    } finally {
      if (thisAttempt === connectAttemptRef.current) {
        setConnecting(false)
        setConnectingDeviceId(null)
      }
    }
  }

  const handleDeleteClick = (id: string) => {
    setDeviceToDelete(id)
  }

  const handleConfirmDelete = async () => {
    if (!deviceToDelete) return
    try {
      await window.go.main.App.DeleteSavedDevice(deviceToDelete)
      setSavedDevices(prev => prev.filter(d => d.id !== deviceToDelete))
    } catch (err) {
      console.error('Failed to delete saved device:', err)
    }
    setDeviceToDelete(null)
  }

  const handleEditDevice = (device: SavedDevice) => {
    setEditingDevice(device)
    setDeviceName(device.name)
    setHost(device.host)
    setAuthType(device.authType)
    if (device.authType === 'key' && device.keyPath) {
      setSelectedKey(device.keyPath)
    }
    setShowAddForm(true)
  }

  const handleSaveEditedDevice = async () => {
    if (!editingDevice) return
    try {
      const pw = authType === 'password' ? password : ''
      const kp = authType === 'key' ? selectedKey : ''
      const kpp = authType === 'key' ? keyPassphrase : ''

      await window.go.main.App.SaveDevice(editingDevice.id, deviceName, host, authType, pw, kp, kpp)

      const devices = await window.go.main.App.GetSavedDevices()
      setSavedDevices(devices || [])

      setEditingDevice(null)
      setShowAddForm(false)
      resetFormFields()
    } catch (err) {
      console.error('Failed to save device:', err)
    }
  }

  const handleCancelForm = () => {
    setShowAddForm(false)
    setEditingDevice(null)
    resetFormFields()
  }

  const resetFormFields = () => {
    setHost('10.11.99.1')
    setAuthType('password')
    setPassword('')
    setKeyPassphrase('')
    setDeviceName('')
    if (availableKeys.length > 0) {
      setSelectedKey(availableKeys[0].path)
    }
    setError('')
  }

  useEffect(() => {
    if (typeof window.runtime === 'undefined') {
      console.log('window.runtime is undefined, events will not work')
      return
    }
    console.log('Setting up event listeners')

    const unsubscribeOutput = window.runtime.EventsOn('command:output', (...args: unknown[]) => {
      const data = args[0] as string
      console.log('Received command:output:', data)

      if (commandContextRef.current === 'maintenance') {
        setMaintenanceOutput((prev) => prev + data)
      } else {
        setOutput((prev) => prev + data)
      }
    })

    const unsubscribeDone = window.runtime.EventsOn('command:done', async (...args: unknown[]) => {
      const success = args[0] as boolean
      console.log('Received command:done:', success)
      setCommandRunning(false)
      if (!success) {
        if (commandContextRef.current === 'maintenance') {
          setMaintenanceOutput((prev) => prev + '\n[Command failed]\n')
        } else {
          setOutput((prev) => prev + '\n[Command failed]\n')
        }
      }
      // Refresh update service status after maintenance commands
      if (commandContextRef.current === 'maintenance') {
        const status = await window.go.main.App.GetUpdateServiceStatus()
        setUpdateServiceStatus(status)
      }
    })

    const unsubscribeProgress = window.runtime.EventsOn('install:progress', (...args: unknown[]) => {
      const progress = args[0] as InstallProgress
      console.log('Received install:progress:', progress)
      setCurrentComponent(progress.component)
      setProgressTotal(progress.total)

      setProgressIndex(progress.index)
      if (progress.status === 'completed') {
        const completedCount = progress.index + 1
        setProgressPercentage(Math.round((completedCount / progress.total) * 100))
      }

      if (progress.status === 'installing') {
        setOutput((prev) => prev + `\n=== Installing ${progress.component} ===\n`)
      } else if (progress.status === 'completed') {
        setOutput((prev) => prev + `${progress.message}\n`)
      } else if (progress.status === 'error') {
        setOutput((prev) => prev + `Error: ${progress.message}\n`)
      }
    })

    const unsubscribeComplete = window.runtime.EventsOn('install:complete', async (...args: unknown[]) => {
      const result = args[0] as InstallResult
      console.log('Received install:complete:', result)

      setLastInstallSuccess(result.success)

      if (result.success) {
        setOutput((prev) => prev + '\n=== Operation complete! ===\n')
        setProgressPercentage(100)
      } else {
        setOutput((prev) => prev + `\nErrors occurred:\n${result.errors.join('\n')}\n`)
      }

      await rescanAllPackages()

      // Re-check OS compatibility after uninstall (packages may now be compatible)
      if (osMismatchDetected) {
        window.go.main.App.GetPackageCompatibilityStatus().then(status => {
          setCompatibilityStatus(status)
        }).catch(() => {})
      }

      // Re-check hashtab version (installs may update the hashtab)
      const hashtabStatus = await window.go.main.App.CheckHashtabVersion()
      if (hashtabStatus.needsRebuild) {
        setHashtabMismatch(hashtabStatus)
      } else {
        setHashtabMismatch(null)
      }

      setInstalling(false)
      setUninstalling(false)
      setCommandRunning(false)
      setCurrentComponent('')
      setCommandContext(null)
      setDialogRequest(null)
      setInstallQueue(new Set())
    })

    const unsubscribeDialog = window.runtime.EventsOn('hook:dialog', (...args: unknown[]) => {
      const dialog = args[0] as DialogRequest
      console.log('Received hook:dialog:', dialog)
      setDialogRequest(dialog)
      setShowRebuildDialog(true)
    })

    const unsubscribeBootstrapPrompt = window.runtime.EventsOn('vellum:bootstrap-prompt', () => {
      console.log('Received vellum:bootstrap-prompt')
      setVellumInstalled(false)
    })

    const unsubscribeBootstrapStart = window.runtime.EventsOn('vellum:bootstrap-start', () => {
      console.log('Received vellum:bootstrap-start')
      setBootstrapping(true)
      setBootstrapOutput('')
      setBootstrapError(null)
    })

    const unsubscribeBootstrapOutput = window.runtime.EventsOn('vellum:bootstrap-output', (...args: unknown[]) => {
      const line = args[0] as string
      setBootstrapOutput((prev) => prev + line)
    })

    const unsubscribeBootstrapComplete = window.runtime.EventsOn('vellum:bootstrap-complete', () => {
      console.log('Received vellum:bootstrap-complete')
      setBootstrapping(false)
      setVellumInstalled(true)
    })

    const unsubscribeBootstrapError = window.runtime.EventsOn('vellum:bootstrap-error', (...args: unknown[]) => {
      const errMsg = args[0] as string
      console.log('Received vellum:bootstrap-error:', errMsg)
      setBootstrapping(false)
      setBootstrapError(errMsg)
    })

    const unsubscribeVellumReady = window.runtime.EventsOn('vellum:ready', () => {
      console.log('Received vellum:ready')
      setVellumInstalled(true)
    })

    const unsubscribeVellumUninstallStart = window.runtime.EventsOn('vellum:uninstall-start', () => {
      console.log('Received vellum:uninstall-start')
      setVellumUninstalling(true)
      setVellumUninstallOutput('')
    })

    const unsubscribeVellumUninstallOutput = window.runtime.EventsOn('vellum:uninstall-output', (...args: unknown[]) => {
      const line = args[0] as string
      setVellumUninstallOutput((prev) => prev + line)
    })

    const unsubscribeVellumUninstallComplete = window.runtime.EventsOn('vellum:uninstall-complete', () => {
      console.log('Received vellum:uninstall-complete')
      setVellumUninstalling(false)
      setVellumInstalled(false)
      setShowSettingsDialog(false)
    })

    const unsubscribeVellumUninstallError = window.runtime.EventsOn('vellum:uninstall-error', (...args: unknown[]) => {
      const errMsg = args[0] as string
      console.log('Received vellum:uninstall-error:', errMsg)
      setVellumUninstalling(false)
      setVellumUninstallOutput((prev) => prev + '\nError: ' + errMsg)
    })

    const unsubscribeHashtabMismatch = window.runtime.EventsOn('hashtab:version-mismatch', (...args: unknown[]) => {
      const status = args[0] as HashtabVersionStatus
      console.log('Received hashtab:version-mismatch:', status)
      setHashtabMismatch(status)
    })

    const unsubscribeOsMismatch = window.runtime.EventsOn('os:mismatch', (...args: unknown[]) => {
      const data = args[0] as { prevVersion: string; newVersion: string }
      console.log('Received os:mismatch:', data)
      setOsMismatchDetected(true)
      setStoredOsVersion(data.prevVersion)
      setCurrentOsVersion(data.newVersion)
    })

    const unsubscribeUpgradeBlocked = window.runtime.EventsOn('upgrade:blocked', (...args: unknown[]) => {
      const compat = args[0] as {
        compatible: string[]
        incompatible: string[]
        noConstraint: string[]
        fetchFailed: boolean
      }
      console.log('Received upgrade:blocked:', compat)
      setChecklistLoading(false)
    })

    const unsubscribeUpgradeError = window.runtime.EventsOn('upgrade:error', (...args: unknown[]) => {
      const errMsg = args[0] as string
      console.log('Received upgrade:error:', errMsg)
      setChecklistLoading(false)
    })

    const unsubscribeUpgradeComplete = window.runtime.EventsOn('upgrade:complete', (...args: unknown[]) => {
      const success = args[0] as boolean
      console.log('Received upgrade:complete:', success)
      setChecklistLoading(false)
      if (success) {
        setOsMismatchDetected(false)
        setCompatibilityStatus(null)
      }
    })

    const unsubscribeAutoUpdate = window.runtime.EventsOn('autoupdate:enabled', () => {
      console.log('Received autoupdate:enabled')
      setShowAutoUpdateBanner(true)
    })

    return () => {
      unsubscribeOutput()
      unsubscribeDone()
      unsubscribeProgress()
      unsubscribeComplete()
      unsubscribeDialog()
      unsubscribeBootstrapPrompt()
      unsubscribeBootstrapStart()
      unsubscribeBootstrapOutput()
      unsubscribeBootstrapComplete()
      unsubscribeBootstrapError()
      unsubscribeVellumReady()
      unsubscribeVellumUninstallStart()
      unsubscribeVellumUninstallOutput()
      unsubscribeVellumUninstallComplete()
      unsubscribeVellumUninstallError()
      unsubscribeHashtabMismatch()
      unsubscribeOsMismatch()
      unsubscribeUpgradeBlocked()
      unsubscribeUpgradeError()
      unsubscribeUpgradeComplete()
      unsubscribeAutoUpdate()
    }
  }, [])

  useEffect(() => {
    if (osMismatchDetected && !compatibilityStatus) {
      setChecklistLoading(true)
      window.go.main.App.GetPackageCompatibilityStatus().then(status => {
        setCompatibilityStatus(status)
        setChecklistLoading(false)
      }).catch(() => {
        setChecklistLoading(false)
      })
    }
  }, [osMismatchDetected, compatibilityStatus])

  const handleConnect = async (saveAfterConnect: boolean) => {
    const thisAttempt = ++connectAttemptRef.current
    setConnecting(true)
    setError('')

    try {
      let result
      if (authType === 'key') {
        result = await window.go.main.App.ConnectWithKey(host, selectedKey, keyPassphrase)
      } else {
        result = await window.go.main.App.Connect(host, password)
      }

      if (thisAttempt !== connectAttemptRef.current) {
        return
      }

      if (result.success) {
        const info = await window.go.main.App.GetDeviceInfo()
        setDevice(result.device || 'unknown')
        setDeviceInfo(info)

        console.log('[DEBUG] handleConnect: calling GetInstalledPackagesWithOsCheck')
        const installedResult = await window.go.main.App.GetInstalledPackagesWithOsCheck()
        console.log('[DEBUG] handleConnect: result =', installedResult)
        setInstalledPackages(new Set(installedResult.packages || []))
        if (installedResult.osUpgraded) {
          setOsUpgradeDetected(true)
          setPrevOsVersion(installedResult.prevVersion)
          setNewOsVersion(installedResult.newVersion)
        }

        const maintCmds: Record<string, MaintenanceCommandInfo[]> = {}
        for (const pkg of packages) {
          const cmds = await window.go.main.App.GetMaintenanceCommands(pkg.name)
          if (cmds && cmds.length > 0) {
            maintCmds[pkg.name] = cmds
          }
        }
        setMaintenanceCommands(maintCmds)

        if (saveAfterConnect) {
          const displayName = getDisplayName(info.machine || '')
          setDeviceName(displayName || host)
          setShowSaveDeviceDialog(true)
        }

        setStep('select')
        setShowAddForm(false)
      } else {
        setError(result.message)
      }
    } catch (err) {
      if (thisAttempt !== connectAttemptRef.current) {
        return
      }
      setError(String(err))
    } finally {
      if (thisAttempt === connectAttemptRef.current) {
        setConnecting(false)
      }
    }
  }

  const handleSaveDevice = async () => {
    try {
      const pw = authType === 'password' ? password : ''
      const kp = authType === 'key' ? selectedKey : ''
      const kpp = authType === 'key' ? keyPassphrase : ''

      await window.go.main.App.SaveDevice('', deviceName, host, authType, pw, kp, kpp)

      const devices = await window.go.main.App.GetSavedDevices()
      setSavedDevices(devices || [])

      setShowSaveDeviceDialog(false)
    } catch (err) {
      console.error('Failed to save device:', err)
    }
  }

  const handleCancelConnect = async () => {
    connectAttemptRef.current++
    await window.go.main.App.CancelConnect()
    setConnecting(false)
    setError('')
  }

  const handleDisconnect = async () => {
    await window.go.main.App.Disconnect()
    setStep('connect')
    setDevice('')
    setDeviceInfo({})
    setInstalledPackages(new Set())
    setInstallQueue(new Set())
    setUninstallQueue(new Set())
    setOutput('')
    setHashtabMismatch(null)
    setOsMismatchDetected(false)
    setOsUpgradeDetected(false)
    setCompatibilityStatus(null)
    setStoredOsVersion('')
    setCurrentOsVersion('')
    setChecklistLoading(false)
    setError('')
    setVellumInstalled(null)
    setBootstrapping(false)
    setBootstrapOutput('')
    setBootstrapError(null)
    setVellumUninstalling(false)
    setVellumUninstallOutput('')
  }

  const handleSaveSettings = async (newTabVisibility: Record<string, boolean>) => {
    setTabVisibility(newTabVisibility)
    await window.go.main.App.SaveSettings(newTabVisibility)
  }

  const handleUninstallVellum = (removeAllPackages: boolean) => {
    window.go.main.App.UninstallVellum(removeAllPackages)
  }

  const getDisplayName = (machine: string) => {
    if (machine.includes('Ferrari')) return 'Paper Pro'
    if (machine.includes('Chiappa')) return 'Paper Pro Move'
    return machine
  }

  const getConflict = (pkg: PackageInfo): string | null => {
    for (const conflict of pkg.conflicts) {
      if (installedPackages.has(conflict)) {
        return `Conflicts with installed: ${conflict}`
      }
      if (installQueue.has(conflict)) {
        return `Conflicts with queued: ${conflict}`
      }
    }
    for (const queuedName of installQueue) {
      const queuedPkg = packages.find(p => p.name === queuedName)
      if (queuedPkg?.conflicts.includes(pkg.name)) {
        return `Conflicts with queued: ${queuedName}`
      }
    }
    return null
  }

  const addToQueue = (name: string) => {
    if (uninstallQueue.has(name)) {
      setQueueError(`Cannot add — ${name} is queued for removal`)
      setTimeout(() => setQueueError(null), 4000)
      return
    }

    const newQueue = new Set(installQueue)
    newQueue.add(name)
    setInstallQueue(newQueue)
  }

  const removeFromQueue = (name: string) => {
    const newQueue = new Set(installQueue)
    newQueue.delete(name)
    setInstallQueue(newQueue)
  }

  const confirmOrphanRemoval = (removeOrphans: boolean) => {
    if (!pendingOrphanRemoval) return

    const newQueue = new Set(installQueue)
    newQueue.delete(pendingOrphanRemoval.itemToRemove)

    if (removeOrphans) {
      for (const orphan of pendingOrphanRemoval.orphans) {
        newQueue.delete(orphan.id)
      }
    }

    setInstallQueue(newQueue)
    setPendingOrphanRemoval(null)
  }

  const clearQueue = () => {
    setInstallQueue(new Set())
  }

  const handleInstallQueue = async (allPackages?: string[]) => {
    const toInstall = allPackages || Array.from(installQueue).filter((name) => !installedPackages.has(name))

    if (toInstall.length === 0) {
      setInstallQueue(new Set())
      return
    }

    setShowProgressModal(true)
    setProgressModalType('install')
    setProgressIndex(0)
    setProgressTotal(toInstall.length)
    setProgressPercentage(0)
    setInstalling(true)
    setOutput('')
    setCommandContext('install')
    setLastOperationType('install')

    await window.go.main.App.InstallPackages(toInstall, device)
    setInstallQueue(new Set())
  }

  const addToUninstallQueue = (name: string) => {
    if (installQueue.has(name)) {
      setQueueError(`Cannot remove — ${name} is queued for installation`)
      setTimeout(() => setQueueError(null), 4000)
      return
    }

    const newQueue = new Set(uninstallQueue)
    newQueue.add(name)
    setUninstallQueue(newQueue)
  }

  const confirmUninstallWithDependents = (includeAll: boolean) => {
    if (!pendingUninstall) return

    const newQueue = new Set(uninstallQueue)
    for (const id of pendingUninstall.componentIds) {
      newQueue.add(id)
    }
    if (includeAll) {
      for (const dep of pendingUninstall.dependents) {
        newQueue.add(dep.id)
      }
    }
    setUninstallQueue(newQueue)
    setPendingUninstall(null)
  }

  const removeFromUninstallQueue = (id: string) => {
    const newQueue = new Set(uninstallQueue)
    newQueue.delete(id)
    setUninstallQueue(newQueue)
  }

  const clearUninstallQueue = () => {
    setUninstallQueue(new Set())
  }

  const handleUninstallQueue = async (allPackages?: string[]) => {
    const toUninstall = allPackages || Array.from(uninstallQueue)

    if (toUninstall.length === 0) {
      setUninstallQueue(new Set())
      return
    }

    setShowProgressModal(true)
    setProgressModalType('install')
    setProgressIndex(0)
    setProgressTotal(toUninstall.length)
    setProgressPercentage(0)
    setUninstalling(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')
    setLastOperationType('uninstall')

    await window.go.main.App.UninstallPackages(toUninstall, device)
    setUninstallQueue(new Set())
  }

  const rescanAllPackages = async () => {
    try {
      const installed = await window.go.main.App.GetInstalledPackages()
      setInstalledPackages(new Set(installed || []))
      return true
    } catch (err) {
      console.error('Failed to rescan package status:', err)
      return false
    }
  }

  const handleRunReenable = async () => {
    setRunningReenable(true)
    setShowProgressModal(true)
    setProgressModalType('maintenance')
    setProgressPercentage(0)
    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.RunReenable()

    setRunningReenable(false)
    setCommandRunning(false)
    setCommandContext(null)
    setOsUpgradeDetected(false)
  }

  const handleHashtabRebuild = async () => {
    setShowProgressModal(true)
    setProgressModalType('maintenance')
    setProgressPercentage(0)
    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.RunMaintenanceCommand('qt-resource-rebuilder', 'rebuild_hashtable', device)

    setHashtabMismatch(null)
  }

  const handleChecklistUpgrade = async () => {
    setChecklistLoading(true)
    setShowProgressModal(true)
    setProgressModalType('maintenance')
    setProgressPercentage(0)
    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.RunUpgrade()

    setChecklistLoading(false)
    setCommandRunning(false)
    setCommandContext(null)
  }

  const handleChecklistReenable = async () => {
    setChecklistLoading(true)
    setShowProgressModal(true)
    setProgressModalType('maintenance')
    setProgressPercentage(0)
    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.RunReenable()

    setChecklistLoading(false)
    setCommandRunning(false)
    setCommandContext(null)
  }

  const fetchUpdateServiceStatus = async () => {
    try {
      const status = await window.go.main.App.GetUpdateServiceStatus()
      setUpdateServiceStatus(status)
    } catch (err) {
      console.error('Failed to fetch update service status:', err)
    }
  }

  const handleSystemTask = async (taskId: string) => {
    setShowProgressModal(true)
    setProgressModalType('maintenance')
    setProgressPercentage(0)
    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.RunSystemTask(taskId, device)
  }

  const handleComponentMaintenance = async (componentId: string, commandId: string) => {
    const cmds = maintenanceCommands[componentId]
    if (!cmds) return

    const cmd = cmds.find(c => c.id === commandId)
    if (!cmd) return

    if (cmd.allowStop) {
      setCurrentRunningCommand({ componentId, commandId })
    }
    setShowProgressModal(true)
    setProgressModalType('maintenance')
    setProgressPercentage(0)
    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.RunMaintenanceCommand(componentId, commandId, device)
  }

  const handleStopCommand = async () => {
    await window.go.main.App.StopCommand()
    setCurrentRunningCommand(null)
    setCommandRunning(false)
    setMaintenanceOutput((prev) => prev + '\n=== Command stopped ===\n')
  }

  const getModalTitle = () => {
    if (installing) return 'Installing Components'
    if (uninstalling) return 'Removing Components'
    if (commandRunning) return 'Running Maintenance'
    return 'Operation Complete'
  }

  const getProgressText = () => {
    if (progressModalType === 'install') {
      if (installing || uninstalling) {
        const action = installing ? 'Installing' : 'Removing'
        return currentComponent
          ? `${action} ${currentComponent} (${progressIndex + 1} of ${progressTotal})`
          : `${action} components...`
      }
      const action = lastOperationType === 'uninstall' ? 'Removal' : 'Installation'
      return lastInstallSuccess === false
        ? `${action} failed`
        : `${action} complete!`
    } else if (progressModalType === 'maintenance') {
      return commandRunning ? 'Running command...' : 'Command complete!'
    }
    return ''
  }

  return (
    <div className="min-h-screen p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">reManager</h1>
            <p className="text-muted-foreground">Manage packages on your reMarkable</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {device && (
              <span className="text-muted-foreground">
                {getDisplayName(deviceInfo.machine || device)} ({deviceInfo.firmware || 'unknown firmware'})
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => setShowSettingsDialog(true)}>
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            {device && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                    <Unplug className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Disconnect</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {step === 'connect' && (
          <>
            {/* Show saved devices list OR add form */}
            {savedDevices.length > 0 && !showAddForm ? (
              <div className="space-y-4">
                {savedDevices.map((savedDevice) => (
                  <Card key={savedDevice.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <h3 className="font-semibold text-lg">{savedDevice.name}</h3>
                          <p className="text-sm text-muted-foreground">{savedDevice.host}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => handleEditDevice(savedDevice)}
                            disabled={connecting}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleDeleteClick(savedDevice.id)}
                            disabled={connecting}
                          >
                            Remove
                          </Button>
                          {connecting && connectingDeviceId === savedDevice.id ? (
                            <Button onClick={handleCancelConnect} variant="outline">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleConnectToSavedDevice(savedDevice.id)}
                              disabled={connecting}
                            >
                              Connect
                            </Button>
                          )}
                        </div>
                      </div>
                      {error && connectingDeviceId === savedDevice.id && (
                        <p className="text-sm text-destructive mt-2">{error}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowAddForm(true)}
                >
                  Add reMarkable
                </Button>
              </div>
            ) : (
              <Card>
                <CardHeader>
                  {editingDevice ? (
                    <Input
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      placeholder="Device Name"
                      className="text-2xl font-semibold h-auto py-1 px-2 -mx-2"
                    />
                  ) : (
                    <CardTitle>Connect to reMarkable</CardTitle>
                  )}
                  <CardDescription>
                    Find your IP and password in Settings - General - Help - Copyrights and licenses.
                    <br />
                    Paper Pro and Paper Pro Move require{' '}
                    <button
                      onClick={() => window.runtime.BrowserOpenURL('https://support.remarkable.com/s/article/Developer-mode')}
                      className="underline hover:text-foreground">
                      developer mode
                    </button>{' '}
                    to be enabled.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="host">IP Address</Label>
                    <Input
                      id="host"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="10.11.99.1"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Authentication</Label>
                    <RadioGroup
                      value={authType}
                      onValueChange={(value) => setAuthType(value as 'password' | 'key')}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="password" id="auth-password" />
                        <Label htmlFor="auth-password" className="cursor-pointer font-normal">Password</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="key" id="auth-key" />
                        <Label htmlFor="auth-key" className="cursor-pointer font-normal">
                          SSH Key
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {authType === 'password' ? (
                    <div className="space-y-2">
                      <Label htmlFor="password">SSH Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter SSH password"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="sshKey">SSH Key</Label>
                        <Select value={selectedKey} onValueChange={handleKeySelect}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a key">
                              {customKeyName || availableKeys.find(k => k.path === selectedKey)?.name || 'Select a key'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {availableKeys.map((key) => (
                              <SelectItem key={key.path} value={key.path}>
                                {key.name}
                              </SelectItem>
                            ))}
                            <SelectItem value="__other__">Other...</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="keyPassphrase">Key Passphrase (if encrypted)</Label>
                        <Input
                          id="keyPassphrase"
                          type="password"
                          value={keyPassphrase}
                          onChange={(e) => setKeyPassphrase(e.target.value)}
                          placeholder="Leave empty if not encrypted"
                        />
                      </div>
                    </>
                  )}

                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex justify-between">
                    <div>
                      {savedDevices.length > 0 && (
                        <Button variant="outline" onClick={handleCancelForm} disabled={connecting}>
                          Cancel
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {connecting ? (
                        <Button onClick={handleCancelConnect} variant="outline">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Cancel
                        </Button>
                      ) : editingDevice ? (
                        <Button
                          onClick={handleSaveEditedDevice}
                          disabled={!deviceName.trim() || (authType === 'password' ? !password : !selectedKey || selectedKey === '__other__')}
                        >
                          Save
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => handleConnect(false)}
                            disabled={authType === 'password' ? !password : !selectedKey || selectedKey === '__other__'}
                          >
                            Connect
                          </Button>
                          <Button
                            onClick={() => handleConnect(true)}
                            disabled={authType === 'password' ? !password : !selectedKey || selectedKey === '__other__'}
                          >
                            Save and Connect
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Notification Banners */}
        {step !== 'connect' && osUpgradeDetected && (
          <div className="mb-4">
            <NotificationBanner
              message={`OS change detected (${prevOsVersion} → ${newOsVersion}). Run reenable to restore system files changed by your mods.`}
              actionLabel="Run Reenable"
              onAction={handleRunReenable}
              onDismiss={() => setOsUpgradeDetected(false)}
              loading={runningReenable}
            />
          </div>
        )}

        {step !== 'connect' && hashtabMismatch && !osMismatchDetected && (
          <div className="mb-4">
            <NotificationBanner
              message={`Hashtable built for OS ${hashtabMismatch.hashtabVersion}, but device is running ${hashtabMismatch.firmwareVersion}. Mods may not work correctly.`}
              actionLabel="Rebuild Hashtable"
              onAction={handleHashtabRebuild}
              onDismiss={() => setHashtabMismatch(null)}
            />
          </div>
        )}

        {step !== 'connect' && showAutoUpdateBanner && (
          <div className="mb-4">
            <NotificationBanner
              message="Auto-updates are enabled. This may interfere with your mods after a system update."
              actionLabel="Go to Maintenance"
              onAction={() => {
                setActiveTab('maintenance')
                setShowAutoUpdateBanner(false)
              }}
              onDismiss={() => setShowAutoUpdateBanner(false)}
            />
          </div>
        )}

        {step !== 'connect' && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'mods' | 'maintenance')}>
            <TabsList className={`grid w-full mb-4 ${tabVisibility.mods ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {tabVisibility.mods && <TabsTrigger value="mods">Mods</TabsTrigger>}
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            </TabsList>

            {tabVisibility.mods && (
            <TabsContent value="mods">
              {vellumInstalled === false ? (
                <VellumInstallPrompt
                  bootstrapping={bootstrapping}
                  bootstrapOutput={bootstrapOutput}
                  bootstrapError={bootstrapError}
                  onInstall={() => window.go.main.App.BootstrapVellum()}
                />
              ) : osMismatchDetected && compatibilityStatus ? (
                <div className={uninstallQueue.size > 0 ? 'pb-48' : ''}>
                  <UpgradeChecklist
                    storedOsVersion={compatibilityStatus.storedOsVersion || storedOsVersion}
                    currentOsVersion={compatibilityStatus.currentOsVersion || currentOsVersion}
                    compatiblePackages={compatibilityStatus.compatiblePackages || []}
                    incompatiblePackages={compatibilityStatus.incompatiblePackages || []}
                    loading={checklistLoading}
                    fetchFailed={compatibilityStatus.fetchFailed || false}
                    uninstallQueue={uninstallQueue}
                    onAddToUninstallQueue={addToUninstallQueue}
                    onRemoveFromUninstallQueue={removeFromUninstallQueue}
                    onRunUpgrade={handleChecklistUpgrade}
                    onRunReenable={handleChecklistReenable}
                  />
                </div>
              ) : (
              <div className={`space-y-6 ${(installQueue.size > 0 || uninstallQueue.size > 0) ? 'pb-48' : ''}`}>
                  {/* Filters */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search mods..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Installed Section */}
                  {installedFiltered.length > 0 && (
                    <Card>
                      <CardHeader
                        className={`cursor-pointer select-none ${installedExpanded ? 'pb-3' : 'py-4'}`}
                        onClick={() => setInstalledExpanded(!installedExpanded)}
                      >
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide flex items-center justify-between">
                          <span>Installed ({installedFiltered.length})</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${installedExpanded ? '' : '-rotate-90'}`} />
                        </CardTitle>
                      </CardHeader>
                      {installedExpanded && (
                        <CardContent className="pt-0">
                          <div className="divide-y">
                            {installedFiltered.map((pkg, index) => {
                              const isQueued = uninstallQueue.has(pkg.name)
                              const prevQueued = index > 0 && uninstallQueue.has(installedFiltered[index - 1].name)
                              const nextQueued = index < installedFiltered.length - 1 && uninstallQueue.has(installedFiltered[index + 1].name)
                              return (
                                <div key={pkg.name} className={`py-3 px-6 -mx-6 flex items-center gap-4 transition-colors ${isQueued ? `border-l-4 border-destructive ${!prevQueued ? 'border-t' : ''} ${!nextQueued ? 'border-b' : ''}` : index % 2 === 1 ? 'bg-muted/50 hover:bg-muted' : 'hover:bg-muted/70'}`}>
                                <div
                                  className="flex-1 min-w-0 cursor-pointer"
                                  onClick={() => setSelectedPackage(pkg)}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{pkg.name}</span>
                                    {pkg.category && <Badge variant="outline">{pkg.category}</Badge>}
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">{pkg.description}</p>
                                  {pkg.upstreamAuthor && (
                                    <span className="text-sm text-muted-foreground">
                                      by {pkg.upstreamAuthor}
                                    </span>
                                  )}
                                </div>
                                {isQueued ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeFromUninstallQueue(pkg.name)}
                                  >
                                    <Check className="h-4 w-4 mr-1" />
                                    Queued
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addToUninstallQueue(pkg.name)}
                                    disabled={installing || uninstalling}
                                  >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Remove
                                  </Button>
                                )}
                                </div>
                              )
                            })}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  )}

                  {/* Available Section */}
                  {availableFiltered.length > 0 && (
                    <Card>
                      <CardHeader
                        className={`cursor-pointer select-none ${availableExpanded ? 'pb-3' : 'py-4'}`}
                        onClick={() => setAvailableExpanded(!availableExpanded)}
                      >
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide flex items-center justify-between">
                          <span>Available ({availableFiltered.length})</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${availableExpanded ? '' : '-rotate-90'}`} />
                        </CardTitle>
                      </CardHeader>
                      {availableExpanded && (
                        <CardContent className="pt-0">
                          <div className="divide-y">
                            {availableFiltered.map((pkg, index) => {
                              const isQueued = installQueue.has(pkg.name)
                              const prevQueued = index > 0 && installQueue.has(availableFiltered[index - 1].name)
                              const nextQueued = index < availableFiltered.length - 1 && installQueue.has(availableFiltered[index + 1].name)
                              const conflict = getConflict(pkg)
                              return (
                                <div key={pkg.name} className={`py-3 px-6 -mx-6 flex items-center gap-4 transition-colors ${isQueued ? `border-l-4 border-primary ${!prevQueued ? 'border-t' : ''} ${!nextQueued ? 'border-b' : ''}` : index % 2 === 1 ? 'bg-muted/50 hover:bg-muted' : 'hover:bg-muted/70'}`}>
                                <div
                                  className="flex-1 min-w-0 cursor-pointer"
                                  onClick={() => setSelectedPackage(pkg)}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{pkg.name}</span>
                                    {pkg.category && <Badge variant="outline">{pkg.category}</Badge>}
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">{pkg.description}</p>
                                  {pkg.upstreamAuthor && (
                                    <span className="text-sm text-muted-foreground">
                                      by {pkg.upstreamAuthor}
                                    </span>
                                  )}
                                </div>
                                {isQueued ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeFromQueue(pkg.name)}
                                  >
                                    <Check className="h-4 w-4 mr-1" />
                                    Queued
                                  </Button>
                                ) : conflict ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled
                                        >
                                          <Plus className="h-4 w-4 mr-1" />
                                          Add
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{conflict}</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addToQueue(pkg.name)}
                                    disabled={installing || uninstalling}
                                  >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add
                                  </Button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </CardContent>
                      )}
                    </Card>
                  )}

                  {filteredPackages.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">
                      {packages.length === 0 ? 'No mods available' : 'No mods match your filters'}
                    </p>
                  )}

                  {/* Queue Error */}
                  {queueError && (
                    <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm">
                      {queueError}
                    </div>
                  )}
                </div>
              )}

              {/* Queue Section - Outside ternary so it shows with both checklist and normal mods */}
              {(installQueue.size > 0 || uninstallQueue.size > 0) && (
                <div className="fixed bottom-0 left-0 right-0 py-4 px-6 bg-background border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50 space-y-4">
                  {/* Install Queue */}
                  {installQueue.size > 0 && (
                    <div>
                      <div
                        className="flex items-center mb-2 cursor-pointer select-none"
                        onClick={() => setInstallQueueExpanded(!installQueueExpanded)}
                      >
                        <span className="text-sm font-medium flex items-center gap-2">
                          Install Queue ({installQueue.size})
                          <ChevronDown className={`h-4 w-4 transition-transform ${installQueueExpanded ? '' : '-rotate-90'}`} />
                        </span>
                      </div>
                      {installQueueExpanded && (
                        <div className="space-y-1 mb-3">
                          {Array.from(installQueue).map((name) => {
                            return (
                              <div
                                key={name}
                                className="flex items-center justify-between text-sm py-1"
                              >
                                <span>{name}</span>
                                <button
                                  onClick={() => removeFromQueue(name)}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={clearQueue}
                          disabled={installing || uninstalling}
                        >
                          Clear Install Queue
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={async () => {
                            setSimulatingInstall(true)
                            try {
                              const sim = await window.go.main.App.SimulateInstall([...installQueue], device)
                              if (sim.packages.length === 0) {
                                setQueueError('All packages are already installed')
                                setTimeout(() => setQueueError(null), 4000)
                                setInstallQueue(new Set())
                              } else {
                                setPendingInstallConfirm({ packages: sim.packages, requested: sim.requested })
                              }
                            } catch (err) {
                              console.error('SimulateInstall failed:', err)
                              const pkgs = [...installQueue]
                              setPendingInstallConfirm({ packages: pkgs, requested: pkgs })
                            } finally {
                              setSimulatingInstall(false)
                            }
                          }}
                          disabled={installing || uninstalling || simulatingInstall}
                        >
                          {installing ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Installing...
                            </>
                          ) : simulatingInstall ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Checking...
                            </>
                          ) : (
                            'Install Selected'
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Uninstall Queue */}
                  {uninstallQueue.size > 0 && (
                    <div>
                      <div
                        className="flex items-center mb-2 cursor-pointer select-none"
                        onClick={() => setUninstallQueueExpanded(!uninstallQueueExpanded)}
                      >
                        <span className="text-sm font-medium text-destructive flex items-center gap-2">
                          Uninstall Queue ({uninstallQueue.size})
                          <ChevronDown className={`h-4 w-4 transition-transform ${uninstallQueueExpanded ? '' : '-rotate-90'}`} />
                        </span>
                      </div>
                      {uninstallQueueExpanded && (
                        <div className="space-y-1 mb-3">
                          {Array.from(uninstallQueue).map((name) => {
                            return (
                              <div
                                key={name}
                                className="flex items-center justify-between text-sm py-1"
                              >
                                <span>{name}</span>
                                <button
                                  onClick={() => removeFromUninstallQueue(name)}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={clearUninstallQueue}
                          disabled={installing || uninstalling}
                        >
                          Clear Uninstall Queue
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={async () => {
                            setSimulatingUninstall(true)
                            try {
                              const selected = [...uninstallQueue]
                              const sim = await window.go.main.App.SimulateUninstall(selected)
                              if (sim.blocked && Object.keys(sim.blocked).length > 0) {
                                setPendingUninstallConfirm({
                                  selected,
                                  packages: sim.recursivePackages || sim.packages,
                                  blocked: sim.blocked,
                                  useRecursive: true
                                })
                              } else {
                                setPendingUninstallConfirm({
                                  selected,
                                  packages: sim.packages.length > 0 ? sim.packages : selected,
                                  blocked: null,
                                  useRecursive: false
                                })
                              }
                            } catch (err) {
                              console.error('SimulateUninstall failed:', err)
                              const selected = [...uninstallQueue]
                              setPendingUninstallConfirm({
                                selected,
                                packages: selected,
                                blocked: null,
                                useRecursive: false
                              })
                            } finally {
                              setSimulatingUninstall(false)
                            }
                          }}
                          disabled={installing || uninstalling || simulatingUninstall}
                        >
                          {uninstalling ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Removing...
                            </>
                          ) : simulatingUninstall ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Checking...
                            </>
                          ) : (
                            'Uninstall Selected'
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
            )}

            <TabsContent value="maintenance">
              <div className="space-y-6">
                {/* System Commands Section */}
                <Card>
                  <CardHeader>
                    <CardTitle>System Commands</CardTitle>
                    <CardDescription>Device-level maintenance tasks</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Auto-Update Status */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Auto-Update Status:</span>
                        <Badge variant={updateServiceStatus.enabled ? 'default' : 'secondary'}>
                          {updateServiceStatus.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        <Badge variant={updateServiceStatus.running ? 'default' : 'secondary'}>
                          {updateServiceStatus.running ? 'Running' : 'Stopped'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {systemTasks.map((task) => {
                          const isEnableDisabled = task.id === 'enable-updates' && updateServiceStatus.enabled && updateServiceStatus.running
                          const isDisableDisabled = task.id === 'disable-updates' && !updateServiceStatus.enabled && !updateServiceStatus.running
                          return (
                            <Button
                              key={task.id}
                              onClick={() => handleSystemTask(task.id)}
                              disabled={commandRunning || isEnableDisabled || isDisableDisabled}
                              variant="outline"
                            >
                              {task.label}
                            </Button>
                          )
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Component Maintenance Section */}
                <Card>
                  <CardHeader>
                    <CardTitle>Package Maintenance</CardTitle>
                    <CardDescription>Package-specific commands</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {packages.filter(p => installedPackages.has(p.name) && maintenanceCommands[p.name]?.length > 0).length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">
                        No installed packages have maintenance commands
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {packages.filter(p => installedPackages.has(p.name) && maintenanceCommands[p.name]).sort((a, b) => a.name.localeCompare(b.name)).map((pkg) => (
                          <div key={pkg.name}>
                            <h4 className="font-medium mb-2">{pkg.name}</h4>
                            <div className="grid grid-cols-3 gap-2">
                              {maintenanceCommands[pkg.name]?.map((cmd) => {
                                const isRunning = currentRunningCommand?.componentId === pkg.name &&
                                                 currentRunningCommand?.commandId === cmd.id

                                return (
                                  <div key={cmd.id} className="flex gap-2">
                                    <Button
                                      onClick={() => handleComponentMaintenance(pkg.name, cmd.id)}
                                      disabled={commandRunning && !isRunning}
                                      variant="outline"
                                      size="sm"
                                      className="flex-1"
                                    >
                                      {cmd.label}
                                    </Button>
                                    {isRunning && cmd.allowStop && (
                                      <Button
                                        onClick={handleStopCommand}
                                        variant="destructive"
                                        size="sm"
                                      >
                                        Stop
                                      </Button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Uninstall Dependents Confirmation Dialog */}
      <Dialog open={pendingUninstall !== null} onOpenChange={(open) => !open && setPendingUninstall(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Components Have Dependents
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-4 pt-4">
                <p>
                  The following installed components depend on{' '}
                  <strong>{pendingUninstall?.componentNames.join(', ')}</strong>:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {pendingUninstall?.dependents.map((dep) => (
                    <li key={dep.id}>{dep.name}</li>
                  ))}
                </ul>
                <p>These components may not work correctly after removal.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPendingUninstall(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => confirmUninstallWithDependents(false)}>
              Remove Only {pendingUninstall?.componentNames[0]}
            </Button>
            <Button variant="destructive" onClick={() => confirmUninstallWithDependents(true)}>
              Remove All ({(pendingUninstall?.componentIds.length || 0) + (pendingUninstall?.dependents.length || 0)})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Orphan Dependency Removal Dialog */}
      <Dialog open={pendingOrphanRemoval !== null} onOpenChange={(open) => !open && setPendingOrphanRemoval(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Dependencies?</DialogTitle>
            <DialogDescription>
              <div className="space-y-4 pt-4">
                <p>
                  The following dependencies are no longer needed by any queued items:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {pendingOrphanRemoval?.orphans.map((dep) => (
                    <li key={dep.id}>{dep.name}</li>
                  ))}
                </ul>
                <p>Would you like to remove them from the queue as well?</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => confirmOrphanRemoval(false)}>
              Keep in Queue
            </Button>
            <Button onClick={() => confirmOrphanRemoval(true)}>
              Remove All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hook Dialog (e.g., Rebuild Qt Resources) */}
      <Dialog open={showRebuildDialog} onOpenChange={setShowRebuildDialog} className="z-[60]">
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {dialogRequest?.title || 'Confirmation Required'}
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-4 pt-4">
                <p>{dialogRequest?.message}</p>
                {dialogRequest?.steps && dialogRequest.steps.length > 0 && (
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    {dialogRequest.steps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRebuildDialog(false)
                setDialogRequest(null)
                window.go.main.App.RespondToDialog(false)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowRebuildDialog(false)
                setDialogRequest(null)
                window.go.main.App.RespondToDialog(true)
              }}
            >
              {dialogRequest?.confirmText || 'Proceed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress Modal */}
      <Dialog
        open={showProgressModal || pendingInstallConfirm !== null || pendingUninstallConfirm !== null}
        onOpenChange={(open) => {
          if (!installing && !uninstalling && !commandRunning) {
            if (!open) {
              setShowProgressModal(false)
              setPendingInstallConfirm(null)
              setPendingUninstallConfirm(null)
              setProgressModalType(null)
              setProgressIndex(0)
              setProgressTotal(0)
              setProgressPercentage(0)
              setOutput('')
              setMaintenanceOutput('')
              setLastInstallSuccess(null)
              setLastOperationType(null)
            }
          }
        }}
        closable={!installing && !uninstalling && !commandRunning}
      >
        <DialogContent className="max-w-6xl w-full">
          {/* Confirmation step for install */}
          {pendingInstallConfirm !== null && !installing && !uninstalling && (() => {
            const requestedSet = new Set(pendingInstallConfirm.requested)
            const requiredBy: Record<string, string[]> = {}
            for (const pkgName of pendingInstallConfirm.packages) {
              if (!requestedSet.has(pkgName)) {
                for (const reqPkg of pendingInstallConfirm.packages) {
                  if (reqPkg === pkgName) continue
                  const pkgInfo = packages.find((p) => p.name === reqPkg)
                  if (pkgInfo?.depends?.includes(pkgName)) {
                    if (!requiredBy[pkgName]) requiredBy[pkgName] = []
                    requiredBy[pkgName].push(reqPkg)
                  }
                }
              }
            }
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Install Packages</DialogTitle>
                  <DialogDescription>
                    The following {pendingInstallConfirm.packages.length} package{pendingInstallConfirm.packages.length !== 1 ? 's' : ''} will be installed:
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[40vh] overflow-y-auto overscroll-y-contain">
                  <ul className="space-y-1 text-sm">
                    {[...pendingInstallConfirm.packages].sort().map((name) => (
                      <li key={name}>
                        {name}
                        {requiredBy[name] && (
                          <span className="text-muted-foreground ml-2">
                            (required by {requiredBy[name].join(', ')})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPendingInstallConfirm(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => {
                    const pkgs = pendingInstallConfirm.packages
                    setPendingInstallConfirm(null)
                    handleInstallQueue(pkgs)
                  }}>
                    Install ({pendingInstallConfirm.packages.length})
                  </Button>
                </DialogFooter>
              </>
            )
          })()}

          {/* Confirmation step for uninstall */}
          {pendingUninstallConfirm !== null && !installing && !uninstalling && (() => {
            // Build a map: dependent -> what it requires
            const dependsOn: Record<string, string[]> = {}
            if (pendingUninstallConfirm.blocked) {
              for (const [pkg, dependents] of Object.entries(pendingUninstallConfirm.blocked)) {
                for (const dep of dependents) {
                  if (!dependsOn[dep]) dependsOn[dep] = []
                  dependsOn[dep].push(pkg)
                }
              }
            }

            const selected = pendingUninstallConfirm.selected
            const additional = pendingUninstallConfirm.packages.filter(pkg => !selected.includes(pkg))

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {additional.length > 0 && (
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                    )}
                    Uninstall Packages
                  </DialogTitle>
                  <DialogDescription>
                    The following {pendingUninstallConfirm.packages.length} package{pendingUninstallConfirm.packages.length !== 1 ? 's' : ''} will be removed:
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[40vh] overflow-y-auto overscroll-y-contain space-y-4">
                  <div>
                    <p className="font-medium text-sm mb-2">Selected for removal:</p>
                    <ul className="space-y-1 text-sm">
                      {[...selected].sort().map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </div>

                  {additional.length > 0 && (
                    <div>
                      <p className="font-medium text-sm mb-2">Will also be removed:</p>
                      <ul className="space-y-1 text-sm">
                        {[...additional].sort().map((name) => (
                          <li key={name}>
                            {name}
                            {dependsOn[name] && (
                              <span className="text-muted-foreground"> (requires {dependsOn[name].join(', ')})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPendingUninstallConfirm(null)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => {
                    const packages = pendingUninstallConfirm.packages
                    setPendingUninstallConfirm(null)
                    handleUninstallQueue(packages)
                  }}>
                    Uninstall ({pendingUninstallConfirm.packages.length})
                  </Button>
                </DialogFooter>
              </>
            )
          })()}

          {/* Progress step */}
          {(showProgressModal || installing || uninstalling || commandRunning) && pendingInstallConfirm === null && pendingUninstallConfirm === null && (
            <ProgressModal
              title={getModalTitle()}
              progressText={getProgressText()}
              percentage={progressPercentage}
              terminalOutput={progressModalType === 'maintenance' ? maintenanceOutput : output}
              isComplete={!installing && !uninstalling && !commandRunning}
              onClose={() => {
                setShowProgressModal(false)
                setOutput('')
                setMaintenanceOutput('')
                setProgressModalType(null)
                setLastInstallSuccess(null)
                setLastOperationType(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <Dialog open={deviceToDelete !== null} onOpenChange={(open) => !open && setDeviceToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove "{savedDevices.find(d => d.id === deviceToDelete)?.name}"?</DialogTitle>
            <DialogDescription>
              This will remove the saved connection and credentials.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeviceToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Device Dialog */}
      <Dialog open={showSaveDeviceDialog} onOpenChange={setShowSaveDeviceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Device</DialogTitle>
            <DialogDescription>
              Save this device for quick reconnection in the future. Your credentials will be stored securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="deviceName">Device Name</Label>
              <Input
                id="deviceName"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={getDisplayName(deviceInfo.machine || '') || 'My reMarkable'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveDeviceDialog(false)}
            >
              Skip
            </Button>
            <Button onClick={handleSaveDevice} disabled={!deviceName.trim()}>
              Save Device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Package Detail Side Panel */}
      <Sheet open={selectedPackage !== null} onOpenChange={(open) => !open && setSelectedPackage(null)}>
        <SheetContent side="right" className="w-[400px] sm:w-[450px] sm:max-w-none flex flex-col">
          {selectedPackage && (
            <PackageDetailPanel
              pkg={selectedPackage}
              isInstalled={installedPackages.has(selectedPackage.name)}
              installedPackages={installedPackages}
              onInstall={() => {
                addToQueue(selectedPackage.name)
                setSelectedPackage(null)
              }}
              onUninstall={() => {
                addToUninstallQueue(selectedPackage.name)
                setSelectedPackage(null)
              }}
              isQueued={installQueue.has(selectedPackage.name) || uninstallQueue.has(selectedPackage.name)}
              queueType={installQueue.has(selectedPackage.name) ? 'install' : uninstallQueue.has(selectedPackage.name) ? 'uninstall' : null}
              disabled={installing || uninstalling}
              onSelectPackage={(name) => {
                const pkg = packages.find(p => p.name === name)
                if (pkg) setSelectedPackage(pkg)
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
        isConnected={!!device}
        vellumInstalled={vellumInstalled}
        tabVisibility={tabVisibility}
        onSaveSettings={handleSaveSettings}
        onUninstallVellum={handleUninstallVellum}
        uninstalling={vellumUninstalling}
        uninstallOutput={vellumUninstallOutput}
        appVersion={appVersion}
      />

    </div>
  )
}
