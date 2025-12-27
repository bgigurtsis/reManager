import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Terminal } from '@/components/Terminal'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Loader2, Unplug, Check, AlertTriangle, Trash2 } from 'lucide-react'
import { componentRegistry } from '@/lib/components/registry'
import '@/lib/components/definitions'
import { createComponentInstaller } from '@/lib/components/engine/installer'
import { DependencyResolver } from '@/lib/components/engine/dependency-resolver'
import { systemTasks } from '@/lib/components/system-tasks'
import { CommandUtils } from '@/lib/components/utils'
import type { CommandContext, DeviceArchitecture, DeviceType, HookExecutionResult } from '@/lib/components/types'

interface SSHKey {
  path: string
  name: string
}

interface UpdateServiceStatus {
  enabled: boolean
  running: boolean
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
          RunCommandWithOutput(cmd: string): Promise<void>
          StopCommand(): Promise<void>
          GetDeviceInfo(): Promise<Record<string, string>>
          GetUpdateServiceStatus(): Promise<UpdateServiceStatus>
          GetDefaultSSHKeys(): Promise<SSHKey[]>
          SelectKeyFile(): Promise<string>
          CheckComponentStatus(componentId: string): Promise<boolean>
        }
      }
    }
    runtime: {
      EventsOn(eventName: string, callback: (...args: unknown[]) => void): () => void
    }
  }
}

const COMPONENTS = componentRegistry.getAll()

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
  const [pendingRebuildCallback, setPendingRebuildCallback] = useState<{ resolve: () => void; reject: (err: Error) => void } | null>(null)
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

  useEffect(() => {
    commandContextRef.current = commandContext
  }, [commandContext])

  useEffect(() => {
    const loadKeys = async () => {
      try {
        const keys = await window.go.main.App.GetDefaultSSHKeys()
        setAvailableKeys(keys || [])
        if (keys && keys.length > 0) {
          setSelectedKey(keys[0].path)
        } else {
          setSelectedKey('__other__')
        }
      } catch (err) {
        console.log('Could not load SSH keys:', err)
        setSelectedKey('__other__')
      }
    }
    loadKeys()
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

  useEffect(() => {
    if (typeof window.runtime === 'undefined') {
      console.log('window.runtime is undefined, events will not work')
      return
    }
    console.log('Setting up event listeners')

    const unsubscribeOutput = window.runtime.EventsOn('command:output', (...args: unknown[]) => {
      const data = args[0] as string
      console.log('Received command:output:', data)

      // Route to appropriate state based on context - read from ref!
      if (commandContextRef.current === 'maintenance') {
        setMaintenanceOutput((prev) => prev + data)
      } else {
        setOutput((prev) => prev + data)
      }
    })

    const unsubscribeDone = window.runtime.EventsOn('command:done', (...args: unknown[]) => {
      const success = args[0] as boolean
      console.log('Received command:done:', success)
      if (!success) {
        if (commandContextRef.current === 'maintenance') {
          setMaintenanceOutput((prev) => prev + '\n[Command failed]\n')
        } else {
          setOutput((prev) => prev + '\n[Command failed]\n')
        }
      }
    })

    return () => {
      unsubscribeOutput()
      unsubscribeDone()
    }
  }, [])

  const handleConnect = async () => {
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

      // Check if this attempt was cancelled
      if (thisAttempt !== connectAttemptRef.current) {
        return
      }

      if (result.success) {
        const info = await window.go.main.App.GetDeviceInfo()
        setDevice(result.device || 'unknown')
        setDeviceInfo(info)

        // Check component status
        const status: Record<string, boolean> = {}
        for (const comp of COMPONENTS) {
          status[comp.id] = await window.go.main.App.CheckComponentStatus(comp.id)
        }
        setComponentStatus(status)

        setStep('select')
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

  const resolver = new DependencyResolver(componentRegistry.getAllAsMap())

  const toggleComponent = (id: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)

      for (const comp of COMPONENTS) {
        if (comp.dependencies.includes(id)) {
          newSelected.delete(comp.id)
        }
      }
    } else {
      newSelected.add(id)

      const deps = resolver.getDependencies(id)
      for (const depId of deps) {
        if (!componentStatus[depId]) {
          newSelected.add(depId)
        }
      }
    }
    setSelected(newSelected)
  }

  const toggleComponentForRemoval = (id: string) => {
    const newSelected = new Set(selectedForRemoval)
    if (newSelected.has(id)) {
      newSelected.delete(id)
      const component = componentRegistry.get(id)
      if (component) {
        for (const depId of component.dependencies) {
          newSelected.delete(depId)
        }
      }
    } else {
      newSelected.add(id)
      const dependents = resolver.getDependents(id)
      for (const depId of dependents) {
        if (componentStatus[depId]) {
          newSelected.add(depId)
        }
      }
    }
    setSelectedForRemoval(newSelected)
  }

  const getArchitecture = (): DeviceArchitecture => {
    if (device === 'rm1' || device === 'rm2') return 'arm32'
    if (device === 'rmpp' || device === 'rmppm') return 'aarch64'
    return 'arm32'
  }

  const getDisplayName = (machine: string) => {
    if (machine.includes('Ferrari')) return 'Paper Pro'
    if (machine.includes('Chiappa')) return 'Paper Pro Move'
    return machine
  }

  const runScript = (script: string): Promise<boolean> => {
    return new Promise((resolve) => {
      console.log('runScript: calling RunCommandWithOutput for:', script.substring(0, 50) + '...')
      const unsubDone = window.runtime.EventsOn('command:done', (...args: unknown[]) => {
        console.log('runScript: command:done received in promise handler')
        unsubDone()
        resolve(args[0] as boolean)
      })
      window.go.main.App.RunCommandWithOutput(script)
    })
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

    setInstalling(true)
    setOutput('')
    setCommandContext('install')

    const installer = createComponentInstaller(
      (id) => componentRegistry.get(id),
      () => componentRegistry.getAllAsMap(),
      (cmd) => {
        setOutput((prev) => prev + `$ ${cmd}\n`)
        return runScript(cmd)
      }
    )

    const context: CommandContext = {
      arch: getArchitecture(),
      device: device as DeviceType,
      isInstalled: false,
      componentsStatus: componentStatus,
    }

    try {
      const result = await installer.install(
        Array.from(selected),
        context,
        (progress) => {
          setCurrentComponent(progress.currentComponent)
          if (progress.status === 'installing') {
            setOutput((prev) => prev + `\n=== Installing ${progress.currentComponent} ===\n`)
          } else if (progress.status === 'completed') {
            setOutput((prev) => prev + `${progress.message}\n`)
          } else if (progress.status === 'error') {
            setOutput((prev) => prev + `Error: ${progress.message}\n`)
          }
        },
        async (hookResult: HookExecutionResult) => {
          if (hookResult.dialogConfig) {
            await new Promise<void>((resolve, reject) => {
              setPendingRebuildCallback({ resolve, reject })
              setShowRebuildDialog(true)
            })

            setRebuildInProgress(true)
            const { command } = hookResult
            if (command) {
              setOutput((prev) => prev + `$ ${command.script}\n`)
              await runScript(command.script)
            }
            setRebuildInProgress(false)
          }
        }
      )

      if (result.success) {
        setOutput((prev) => prev + '\n=== Installation complete! ===\n')
        setOutput((prev) => prev + 'Run xovi/start or triple-tap the power button to start xovi.\n')
      } else {
        setOutput((prev) => prev + `\nErrors occurred:\n${result.errors.join('\n')}\n`)
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') {
        setOutput((prev) => prev + '\n=== Installation cancelled ===\n')
      } else {
        setOutput((prev) => prev + `\nError: ${err}\n`)
      }
    } finally {
      setInstalling(false)
      setCurrentComponent('')
      setCommandContext(null)
    }
  }

  const handleUninstall = async () => {
    setUninstalling(true)
    setMaintenanceOutput('')

    const installer = createComponentInstaller(
      (id) => componentRegistry.get(id),
      () => componentRegistry.getAllAsMap(),
      (cmd) => {
        setMaintenanceOutput((prev) => prev + `$ ${cmd}\n`)
        return runScript(cmd)
      }
    )

    const context: CommandContext = {
      arch: getArchitecture(),
      device: device as DeviceType,
      isInstalled: true,
      componentsStatus: componentStatus,
    }

    try {
      const result = await installer.uninstall(
        Array.from(selectedForRemoval),
        context,
        (progress) => {
          if (progress.status === 'installing') {
            setMaintenanceOutput((prev) => prev + `\n=== Uninstalling ${progress.currentComponent} ===\n`)
          } else if (progress.status === 'completed') {
            setMaintenanceOutput((prev) => prev + `${progress.message}\n`)
          } else if (progress.status === 'error') {
            setMaintenanceOutput((prev) => prev + `Error: ${progress.message}\n`)
          }
        }
      )

      if (result.success) {
        setMaintenanceOutput((prev) => prev + '\n=== Uninstall complete! ===\n')

        // Refresh component status
        const status: Record<string, boolean> = {}
        for (const comp of COMPONENTS) {
          status[comp.id] = await window.go.main.App.CheckComponentStatus(comp.id)
        }
        setComponentStatus(status)
        setSelectedForRemoval(new Set())
      } else {
        setMaintenanceOutput((prev) => prev + `\nErrors occurred:\n${result.errors.join('\n')}\n`)
      }
    } catch (err) {
      setMaintenanceOutput((prev) => prev + `\nError: ${err}\n`)
    } finally {
      setUninstalling(false)
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
    const task = systemTasks.find(t => t.id === taskId)
    if (!task) return

    setCommandRunning(true)
    setMaintenanceOutput('')

    const context: CommandContext = {
      arch: getArchitecture(),
      device: device as DeviceType,
      isInstalled: false,
      componentsStatus: componentStatus,
    }

    const commands = task.command(context)
    if (!commands) {
      setCommandRunning(false)
      return
    }

    const cmdArray = Array.isArray(commands) ? commands : [commands]
    let wrappedCommands = cmdArray

    // Wrap with writeable root if needed
    if (task.needsWriteableRoot) {
      wrappedCommands = CommandUtils.wrapWithWriteableRoot(cmdArray, device as DeviceType)
    }

    try {
      for (const cmd of wrappedCommands) {
        setMaintenanceOutput((prev) => prev + `$ ${cmd.script}\n`)
        const success = await runScript(cmd.script)
        if (!success) {
          setMaintenanceOutput((prev) => prev + `Error executing: ${cmd.description}\n`)
          break
        }
      }
      setMaintenanceOutput((prev) => prev + '\n=== Command complete ===\n')

      // Refresh update service status after running system tasks
      await fetchUpdateServiceStatus()
    } catch (err) {
      setMaintenanceOutput((prev) => prev + `\nError: ${err}\n`)
    } finally {
      setCommandRunning(false)
    }
  }

  const handleComponentMaintenance = async (componentId: string, commandId: string) => {
    const component = componentRegistry.get(componentId)
    if (!component?.maintenanceCommands) return

    const cmd = component.maintenanceCommands.find(c => c.id === commandId)
    if (!cmd) return

    if (cmd.allowStop) {
      setCurrentRunningCommand({ componentId, commandId })
    }

    setCommandRunning(true)
    setMaintenanceOutput('')
    setCommandContext('maintenance')

    const context: CommandContext = {
      arch: getArchitecture(),
      device: device as DeviceType,
      isInstalled: true,
      componentsStatus: componentStatus,
    }

    const command = cmd.command(context)
    if (!command) {
      setCommandRunning(false)
      return
    }

    const cmdArray = Array.isArray(command) ? command : [command]
    let wrappedCommands = cmdArray

    // Wrap with writeable root if needed
    if (cmd.needsWriteableRoot) {
      wrappedCommands = CommandUtils.wrapWithWriteableRoot(cmdArray, device as DeviceType)
    }

    try {
      for (const c of wrappedCommands) {
        setMaintenanceOutput((prev) => prev + `$ ${c.script}\n`)
        const success = await runScript(c.script)
        if (!success) {
          setMaintenanceOutput((prev) => prev + `Error executing: ${c.description}\n`)
          break
        }
      }
      setMaintenanceOutput((prev) => prev + '\n=== Command complete ===\n')
    } catch (err) {
      setMaintenanceOutput((prev) => prev + `\nError: ${err}\n`)
    } finally {
      setCommandRunning(false)
      setCurrentRunningCommand(null)
      setCommandContext(null)
    }
  }

  const handleStopCommand = async () => {
    await window.go.main.App.StopCommand()
    setCurrentRunningCommand(null)
    setCommandRunning(false)
    setMaintenanceOutput((prev) => prev + '\n=== Command stopped ===\n')
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Xovi Installer</h1>
            <p className="text-muted-foreground">Install xovi and extensions on your reMarkable</p>
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
          <Card>
            <CardHeader>
              <CardTitle>Connect to your reMarkable</CardTitle>
              <CardDescription>
                Find your IP and password in Settings → General → Help → Copyrights and licenses
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
              <div className="flex justify-end">
                {connecting ? (
                  <Button onClick={handleCancelConnect} variant="outline">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cancel
                  </Button>
                ) : (
                  <Button
                    onClick={handleConnect}
                    disabled={authType === 'password' ? !password : !selectedKey || selectedKey === '__other__'}
                  >
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
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
                        {COMPONENTS.map((comp) => {
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

                      {(installing || output) && (
                        <div className="mt-4">
                          <div className="h-[400px] rounded-lg overflow-hidden">
                            <Terminal output={output} />
                          </div>
                          {!installing && output && (
                            <div className="mt-4 flex justify-end gap-2">
                              <Button onClick={() => { setOutput(''); setSelected(new Set()) }}>
                                Install More
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {modsView === 'remove' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {COMPONENTS.filter(comp => componentStatus[comp.id]).map((comp) => {
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

                      {COMPONENTS.filter(comp => componentStatus[comp.id]).length === 0 && (
                        <p className="text-center text-muted-foreground py-8">
                          No components installed
                        </p>
                      )}

                      {COMPONENTS.filter(comp => componentStatus[comp.id]).length > 0 && (
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

                      {(uninstalling || (maintenanceOutput && modsView === 'remove')) && (
                        <div className="mt-4">
                          <div className="h-[400px] rounded-lg overflow-hidden">
                            <Terminal output={maintenanceOutput} />
                          </div>
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
                    {COMPONENTS.filter(c => componentStatus[c.id] && c.maintenanceCommands && c.maintenanceCommands.length > 0).length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">
                        No installed components have maintenance commands
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {COMPONENTS.filter(c => componentStatus[c.id] && c.maintenanceCommands).map((component) => (
                          <div key={component.id}>
                            <h4 className="font-medium mb-2">{component.name}</h4>
                            <div className="grid grid-cols-3 gap-2">
                              {component.maintenanceCommands?.map((cmd) => {
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

                {/* Maintenance Output Terminal */}
                {maintenanceOutput && activeTab === 'maintenance' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Command Output</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[400px] rounded-lg overflow-hidden">
                        <Terminal output={maintenanceOutput} />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Overwrite Confirmation Dialog */}
      <Dialog open={showOverwriteDialog} onOpenChange={setShowOverwriteDialog}>
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
                    const comp = COMPONENTS.find(c => c.id === id)
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

      {/* Rebuild Hashtable Dialog */}
      <Dialog open={showRebuildDialog} onOpenChange={setShowRebuildDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {rebuildInProgress ? 'Rebuilding Qt Resources...' : 'Rebuild Qt Resources'}
            </DialogTitle>
            <DialogDescription>
              {rebuildInProgress ? (
                <div className="space-y-4 pt-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Please enter your passcode on the tablet if prompted</span>
                  </div>
                  <p className="text-sm">This may take up to 2 minutes. The tablet will restart twice.</p>
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  <p>This process will:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Restart the tablet interface</li>
                    <li>Ask for your passcode (if you have one set)</li>
                    <li>Generate hashtable (~1 minute)</li>
                    <li>Restart the tablet interface again</li>
                  </ol>
                  <p className="font-medium">Please keep your tablet nearby and ready to enter your passcode when prompted.</p>
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
                  if (pendingRebuildCallback) {
                    pendingRebuildCallback.reject(new Error('cancelled'))
                    setPendingRebuildCallback(null)
                  }
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowRebuildDialog(false)
                  if (pendingRebuildCallback) {
                    pendingRebuildCallback.resolve()
                    setPendingRebuildCallback(null)
                  }
                }}
              >
                Ready, Proceed
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
