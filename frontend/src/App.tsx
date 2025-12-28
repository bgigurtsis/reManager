import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ProgressModal } from '@/components/ProgressModal'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Loader2, Unplug, Check, AlertTriangle, Trash2 } from 'lucide-react'

interface ComponentInfo {
  id: string
  name: string
  description: string
  version: string
  author: string
  dependencies: string[]
  category: string
  tags: string[]
}

interface MaintenanceCommandInfo {
  id: string
  label: string
  description: string
  requiresTerminal: boolean
  allowStop: boolean
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
          CheckComponentStatus(componentId: string): Promise<boolean>
          GetComponents(): Promise<ComponentInfo[]>
          ResolveDependencies(componentIds: string[]): Promise<string[]>
          GetComponentDependents(componentId: string): Promise<string[]>
          GetMaintenanceCommands(componentId: string): Promise<MaintenanceCommandInfo[]>
          GetSystemTasksInfo(): Promise<SystemTaskInfo[]>
          GetDeviceDisplayName(machine: string): Promise<string>
          GetDeviceArchitecture(deviceType: string): Promise<string>
          InstallComponents(componentIds: string[], deviceType: string): Promise<void>
          UninstallComponents(componentIds: string[], deviceType: string): Promise<void>
          RunMaintenanceCommand(componentId: string, commandId: string, deviceType: string): Promise<void>
          RunSystemTask(taskId: string, deviceType: string): Promise<void>
          RespondToDialog(confirmed: boolean): Promise<void>
        }
      }
    }
    runtime: {
      EventsOn(eventName: string, callback: (...args: unknown[]) => void): () => void
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [componentStatus, setComponentStatus] = useState<Record<string, boolean>>({})
  const [installing, setInstalling] = useState(false)
  const [output, setOutput] = useState('')
  const [currentComponent, setCurrentComponent] = useState('')
  const [showRebuildDialog, setShowRebuildDialog] = useState(false)
  const [rebuildInProgress, setRebuildInProgress] = useState(false)
  const [dialogRequest, setDialogRequest] = useState<DialogRequest | null>(null)
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false)
  const [componentsToOverwrite, setComponentsToOverwrite] = useState<string[]>([])
  const [pendingInstallCallback, setPendingInstallCallback] = useState<{ resolve: () => void; reject: () => void } | null>(null)
  const connectAttemptRef = useRef(0)

  const [activeTab, setActiveTab] = useState<'mods' | 'maintenance'>('mods')
  const [modsView, setModsView] = useState<'install' | 'remove'>('install')
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
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
  const [commandContext, setCommandContext] = useState<'install' | 'maintenance' | null>(null)
  const commandContextRef = useRef<'install' | 'maintenance' | null>(null)

  const [showProgressModal, setShowProgressModal] = useState(false)
  const [progressModalType, setProgressModalType] = useState<'install' | 'maintenance' | null>(null)
  const [progressIndex, setProgressIndex] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressPercentage, setProgressPercentage] = useState(0)

  const [components, setComponents] = useState<ComponentInfo[]>([])
  const [systemTasks, setSystemTasks] = useState<SystemTaskInfo[]>([])
  const [maintenanceCommands, setMaintenanceCommands] = useState<Record<string, MaintenanceCommandInfo[]>>({})

  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [showSaveDeviceDialog, setShowSaveDeviceDialog] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null)
  const [editingDevice, setEditingDevice] = useState<SavedDevice | null>(null)
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null)

  useEffect(() => {
    commandContextRef.current = commandContext
  }, [commandContext])

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [keys, comps, tasks, devices] = await Promise.all([
          window.go.main.App.GetDefaultSSHKeys(),
          window.go.main.App.GetComponents(),
          window.go.main.App.GetSystemTasksInfo(),
          window.go.main.App.GetSavedDevices(),
        ])

        setAvailableKeys(keys || [])
        if (keys && keys.length > 0) {
          setSelectedKey(keys[0].path)
        } else {
          setSelectedKey('__other__')
        }

        setComponents(comps || [])
        setSystemTasks(tasks || [])
        setSavedDevices(devices || [])
      } catch (err) {
        console.log('Could not load initial data:', err)
        setSelectedKey('__other__')
      }
    }
    loadInitialData()
  }, [])

  useEffect(() => {
    if (activeTab === 'maintenance' && step === 'install') {
      fetchUpdateServiceStatus()
    }
  }, [activeTab, step])

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

        const status: Record<string, boolean> = {}
        const maintCmds: Record<string, MaintenanceCommandInfo[]> = {}
        for (const comp of components) {
          status[comp.id] = await window.go.main.App.CheckComponentStatus(comp.id)
          const cmds = await window.go.main.App.GetMaintenanceCommands(comp.id)
          if (cmds && cmds.length > 0) {
            maintCmds[comp.id] = cmds
          }
        }
        setComponentStatus(status)
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

    const unsubscribeDone = window.runtime.EventsOn('command:done', (...args: unknown[]) => {
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
    })

    const unsubscribeProgress = window.runtime.EventsOn('install:progress', (...args: unknown[]) => {
      const progress = args[0] as InstallProgress
      console.log('Received install:progress:', progress)
      setCurrentComponent(progress.component)
      setProgressTotal(progress.total)

      // Update progress bar only when components complete
      if (progress.status === 'completed') {
        const completedCount = progress.index + 1
        setProgressIndex(completedCount)
        setProgressPercentage(Math.round((completedCount / progress.total) * 100))
      } else {
        // For installing/error states, just update the index for display
        setProgressIndex(progress.index)
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

      if (result.success) {
        setOutput((prev) => prev + '\n=== Installation complete! ===\n')
        setOutput((prev) => prev + 'Run xovi/start or triple-tap the power button to start xovi.\n')
        setProgressPercentage(100)
      } else {
        setOutput((prev) => prev + `\nErrors occurred:\n${result.errors.join('\n')}\n`)
      }

      await rescanAllComponents()

      setInstalling(false)
      setUninstalling(false)
      setCommandRunning(false)
      setCurrentComponent('')
      setCommandContext(null)
      setRebuildInProgress(false)
      setDialogRequest(null)
      setSelected(new Set())
    })

    const unsubscribeDialog = window.runtime.EventsOn('hook:dialog', (...args: unknown[]) => {
      const dialog = args[0] as DialogRequest
      console.log('Received hook:dialog:', dialog)
      setDialogRequest(dialog)
      setShowRebuildDialog(true)
    })

    return () => {
      unsubscribeOutput()
      unsubscribeDone()
      unsubscribeProgress()
      unsubscribeComplete()
      unsubscribeDialog()
    }
  }, [])

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

        const status: Record<string, boolean> = {}
        const maintCmds: Record<string, MaintenanceCommandInfo[]> = {}
        for (const comp of components) {
          status[comp.id] = await window.go.main.App.CheckComponentStatus(comp.id)
          const cmds = await window.go.main.App.GetMaintenanceCommands(comp.id)
          if (cmds && cmds.length > 0) {
            maintCmds[comp.id] = cmds
          }
        }
        setComponentStatus(status)
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
    setSelected(new Set())
    setOutput('')
  }

  const toggleComponent = async (id: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)

      for (const comp of components) {
        if (comp.dependencies.includes(id)) {
          newSelected.delete(comp.id)
        }
      }
    } else {
      newSelected.add(id)

      try {
        const resolved = await window.go.main.App.ResolveDependencies([id])
        for (const depId of resolved) {
          if (!componentStatus[depId]) {
            newSelected.add(depId)
          }
        }
      } catch (err) {
        console.error('Error resolving dependencies:', err)
      }
    }
    setSelected(newSelected)
  }

  const toggleComponentForRemoval = async (id: string) => {
    const newSelected = new Set(selectedForRemoval)
    if (newSelected.has(id)) {
      newSelected.delete(id)

      const comp = components.find(c => c.id === id)
      if (comp) {
        for (const depId of comp.dependencies) {
          newSelected.delete(depId)
        }
      }
    } else {
      newSelected.add(id)

      try {
        const dependents = await window.go.main.App.GetComponentDependents(id)
        for (const depId of dependents) {
          if (componentStatus[depId]) {
            newSelected.add(depId)
          }
        }
      } catch (err) {
        console.error('Error getting dependents:', err)
      }
    }
    setSelectedForRemoval(newSelected)
  }

  const getDisplayName = (machine: string) => {
    if (machine.includes('Ferrari')) return 'Paper Pro'
    if (machine.includes('Chiappa')) return 'Paper Pro Move'
    return machine
  }

  const handleInstall = async () => {
    const toOverwrite = Array.from(selected).filter((id) => componentStatus[id])

    if (toOverwrite.length > 0) {
      setComponentsToOverwrite(toOverwrite)
      setShowOverwriteDialog(true)

      try {
        await new Promise<void>((resolve, reject) => {
          setPendingInstallCallback({ resolve, reject })
        })
      } catch {
        return
      }
    }

    setShowProgressModal(true)
    setProgressModalType('install')
    setProgressIndex(0)
    setProgressTotal(selected.size)
    setProgressPercentage(0)
    setInstalling(true)
    setOutput('')
    setCommandContext('install')

    await window.go.main.App.InstallComponents(Array.from(selected), device)
  }

  const handleUninstall = async () => {
    setShowProgressModal(true)
    setProgressModalType('install')
    setProgressIndex(0)
    setProgressTotal(selectedForRemoval.size)
    setProgressPercentage(0)
    setUninstalling(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    await window.go.main.App.UninstallComponents(Array.from(selectedForRemoval), device)

    setSelectedForRemoval(new Set())
  }

  const rescanAllComponents = async () => {
    try {
      const freshComponents = await window.go.main.App.GetComponents()

      const status: Record<string, boolean> = {}
      for (const comp of freshComponents) {
        status[comp.id] = await window.go.main.App.CheckComponentStatus(comp.id)
      }
      setComponentStatus(status)
      return true
    } catch (err) {
      console.error('Failed to rescan component status:', err)
      return false
    }
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
    await fetchUpdateServiceStatus()

    setCommandRunning(false)
    setCommandContext(null)
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

    setCommandRunning(false)
    setCurrentRunningCommand(null)
    setCommandContext(null)
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
      return 'Installation complete!'
    } else if (progressModalType === 'maintenance') {
      return commandRunning ? 'Running command...' : 'Command complete!'
    }
    return ''
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">reManager</h1>
            <p className="text-muted-foreground">Manage xovi and extensions on your reMarkable</p>
          </div>
          {device && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {getDisplayName(deviceInfo.machine || device)} ({deviceInfo.firmware || 'unknown firmware'})
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                    <Unplug className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Disconnect</TooltipContent>
              </Tooltip>
            </div>
          )}
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
                          <Button
                            onClick={() => handleConnectToSavedDevice(savedDevice.id)}
                            disabled={connecting}
                          >
                            {connecting && connectingDeviceId === savedDevice.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Connecting...
                              </>
                            ) : (
                              'Connect'
                            )}
                          </Button>
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
                    Find your IP and password in Settings - General - Help - Copyrights and licenses
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

        {step !== 'connect' && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'mods' | 'maintenance')}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="mods">Mods</TabsTrigger>
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            </TabsList>

            <TabsContent value="mods">
              <Card>
                <CardHeader>
                  <CardTitle>Mod Management</CardTitle>
                  <CardDescription>Install or remove mods on your device</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 mb-6">
                    <Button
                      onClick={() => setModsView('install')}
                      variant={modsView === 'install' ? 'default' : 'outline'}
                    >
                      Install Mods
                    </Button>
                    <Button
                      onClick={() => setModsView('remove')}
                      variant={modsView === 'remove' ? 'destructive' : 'outline'}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove Mods
                    </Button>
                  </div>

                  {modsView === 'install' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {components.map((comp) => {
                          const isSelected = selected.has(comp.id)
                          const isRequired = comp.id === 'xovi' && selected.size > 1 && !componentStatus['xovi']

                          return (
                            <div
                              key={comp.id}
                              className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                                isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                              } ${isRequired ? 'opacity-75' : ''}`}
                              onClick={() => !isRequired && toggleComponent(comp.id)}
                            >
                              <div
                                className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                                  isSelected ? 'bg-primary border-primary' : 'border-input'
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{comp.name}</span>
                                  {componentStatus[comp.id] && (
                                    <span className="text-xs px-2 py-0.5 rounded border border-primary text-primary font-medium">
                                      Installed
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">{comp.description}</p>
                                {comp.dependencies.length > 0 && (
                                  <div className="flex gap-1 mt-1">
                                    {comp.dependencies.map((dep) => (
                                      <span
                                        key={dep}
                                        className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground"
                                      >
                                        {dep}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="pt-4 flex justify-end">
                        <Button onClick={handleInstall} disabled={selected.size === 0 || installing}>
                          {installing ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Installing {currentComponent}...
                            </>
                          ) : (
                            `Install ${selected.size} component${selected.size !== 1 ? 's' : ''}`
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {modsView === 'remove' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {components.filter(comp => componentStatus[comp.id]).map((comp) => {
                          const isSelected = selectedForRemoval.has(comp.id)

                          return (
                            <div
                              key={comp.id}
                              className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                                isSelected ? 'border-destructive bg-destructive/5' : 'border-border hover:border-destructive/50'
                              }`}
                              onClick={() => toggleComponentForRemoval(comp.id)}
                            >
                              <div
                                className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                                  isSelected ? 'bg-destructive border-destructive' : 'border-input'
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3 text-destructive-foreground" />}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{comp.name}</span>
                                </div>
                                <p className="text-sm text-muted-foreground">{comp.description}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {components.filter(comp => componentStatus[comp.id]).length === 0 && (
                        <p className="text-center text-muted-foreground py-8">
                          No components installed
                        </p>
                      )}

                      {components.filter(comp => componentStatus[comp.id]).length > 0 && (
                        <div className="pt-4 flex justify-end">
                          <Button
                            onClick={handleUninstall}
                            disabled={selectedForRemoval.size === 0 || uninstalling}
                            variant="destructive"
                          >
                            {uninstalling ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Removing...
                              </>
                            ) : (
                              `Remove ${selectedForRemoval.size} component${selectedForRemoval.size !== 1 ? 's' : ''}`
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

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
                      <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                        <span className="text-sm font-medium">Auto-Update Status:</span>
                        <div className="flex gap-2">
                          <span className={`text-xs px-2 py-1 rounded ${updateServiceStatus.enabled ? 'bg-green-500/20 text-green-700' : 'bg-gray-500/20 text-gray-700'}`}>
                            {updateServiceStatus.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${updateServiceStatus.running ? 'bg-blue-500/20 text-blue-700' : 'bg-gray-500/20 text-gray-700'}`}>
                            {updateServiceStatus.running ? 'Running' : 'Stopped'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {systemTasks.map((task) => (
                          <Button
                            key={task.id}
                            onClick={() => handleSystemTask(task.id)}
                            disabled={commandRunning}
                            variant="outline"
                          >
                            {task.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Component Maintenance Section */}
                <Card>
                  <CardHeader>
                    <CardTitle>Component Maintenance</CardTitle>
                    <CardDescription>Component-specific commands</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {components.filter(c => componentStatus[c.id] && maintenanceCommands[c.id]?.length > 0).length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">
                        No installed components have maintenance commands
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {components.filter(c => componentStatus[c.id] && maintenanceCommands[c.id]).map((component) => (
                          <div key={component.id}>
                            <h4 className="font-medium mb-2">{component.name}</h4>
                            <div className="grid grid-cols-3 gap-2">
                              {maintenanceCommands[component.id]?.map((cmd) => {
                                const isRunning = currentRunningCommand?.componentId === component.id &&
                                                 currentRunningCommand?.commandId === cmd.id

                                return (
                                  <div key={cmd.id} className="flex gap-2">
                                    <Button
                                      onClick={() => handleComponentMaintenance(component.id, cmd.id)}
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

      {/* Overwrite Confirmation Dialog */}
      <Dialog open={showOverwriteDialog} onOpenChange={setShowOverwriteDialog} className="z-[60]">
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Components Already Installed
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-4 pt-4">
                <p>The following components are already installed and will be re-installed:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {componentsToOverwrite.map(id => {
                    const comp = components.find(c => c.id === id)
                    return <li key={id}>{comp?.name || id}</li>
                  })}
                </ul>
                <p className="font-medium">Do you want to continue?</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowOverwriteDialog(false)
                if (pendingInstallCallback) {
                  pendingInstallCallback.reject()
                  setPendingInstallCallback(null)
                }
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowOverwriteDialog(false)
                if (pendingInstallCallback) {
                  pendingInstallCallback.resolve()
                  setPendingInstallCallback(null)
                }
              }}
            >
              Continue
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
              {rebuildInProgress ? (dialogRequest?.inProgressMessage || 'Processing...') : (dialogRequest?.title || 'Confirmation Required')}
            </DialogTitle>
            <DialogDescription>
              {rebuildInProgress ? (
                <div className="space-y-4 pt-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>{dialogRequest?.inProgressMessage || 'Please wait...'}</span>
                  </div>
                </div>
              ) : (
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
              )}
            </DialogDescription>
          </DialogHeader>
          {!rebuildInProgress && (
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
                  setRebuildInProgress(true)
                  window.go.main.App.RespondToDialog(true)
                }}
              >
                {dialogRequest?.confirmText || 'Proceed'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Progress Modal */}
      <Dialog
        open={showProgressModal}
        onOpenChange={(open) => {
          if (!installing && !uninstalling && !commandRunning) {
            setShowProgressModal(open)
            if (!open) {
              setProgressModalType(null)
              setProgressIndex(0)
              setProgressTotal(0)
              setProgressPercentage(0)
              setOutput('')
              setMaintenanceOutput('')
            }
          }
        }}
        closable={!installing && !uninstalling && !commandRunning}
      >
        <DialogContent className="max-w-6xl w-full">
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
            }}
          />
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
    </div>
  )
}
