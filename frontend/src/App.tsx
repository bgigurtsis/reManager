import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Terminal } from '@/components/Terminal'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Loader2, Wifi, Unplug, Check, Package, AlertTriangle, X } from 'lucide-react'

interface SSHKey {
  path: string
  name: string
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
          GetDeviceInfo(): Promise<Record<string, string>>
          GetDefaultSSHKeys(): Promise<SSHKey[]>
          SelectKeyFile(): Promise<string>
        }
      }
    }
    runtime: {
      EventsOn(eventName: string, callback: (...args: unknown[]) => void): () => void
    }
  }
}

interface Component {
  id: string
  name: string
  description: string
  requiresXovi: boolean
  requiresQtRebuilder: boolean
}

const COMPONENTS: Component[] = [
  {
    id: 'xovi',
    name: 'Xovi',
    description: 'Base framework for reMarkable modifications',
    requiresXovi: false,
    requiresQtRebuilder: false,
  },
  {
    id: 'qt-resource-rebuilder',
    name: 'Qt Resource Rebuilder',
    description: 'Enables UI modifications like rM Hacks',
    requiresXovi: true,
    requiresQtRebuilder: false,
  },
  {
    id: 'tripletap',
    name: 'Tripletap',
    description: 'Start xovi by triple-pressing the power button',
    requiresXovi: true,
    requiresQtRebuilder: false,
  },
  {
    id: 'rm-hacks',
    name: 'rM Hacks',
    description: 'Split screen, custom pen sizes, and more',
    requiresXovi: true,
    requiresQtRebuilder: true,
  },
  {
    id: 'appload',
    name: 'AppLoad',
    description: 'Run third-party apps like KOReader',
    requiresXovi: true,
    requiresQtRebuilder: true,
  },
]

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
  const [selected, setSelected] = useState<Set<string>>(new Set(['xovi']))
  const [installing, setInstalling] = useState(false)
  const [installCancelled, setInstallCancelled] = useState(false)
  const [output, setOutput] = useState('')
  const [currentComponent, setCurrentComponent] = useState('')
  const [showRebuildDialog, setShowRebuildDialog] = useState(false)
  const [rebuildInProgress, setRebuildInProgress] = useState(false)
  const [pendingRebuildCallback, setPendingRebuildCallback] = useState<{ resolve: () => void; reject: (err: Error) => void } | null>(null)
  const connectAttemptRef = useRef(0)

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
      setOutput((prev) => prev + data)
    })

    const unsubscribeDone = window.runtime.EventsOn('command:done', (...args: unknown[]) => {
      const success = args[0] as boolean
      console.log('Received command:done:', success)
      if (!success) {
        setOutput((prev) => prev + '\n[Command failed]\n')
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
    setSelected(new Set(['xovi']))
    setOutput('')
  }

  const toggleComponent = (id: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      if (id === 'xovi') return
      newSelected.delete(id)
      if (id === 'qt-resource-rebuilder') {
        newSelected.delete('rm-hacks')
        newSelected.delete('appload')
      }
    } else {
      newSelected.add(id)
      const comp = COMPONENTS.find((c) => c.id === id)
      if (comp?.requiresXovi) newSelected.add('xovi')
      if (comp?.requiresQtRebuilder) {
        newSelected.add('xovi')
        newSelected.add('qt-resource-rebuilder')
      }
    }
    setSelected(newSelected)
  }

  const getArchitecture = () => {
    if (device === 'rm1' || device === 'rm2') return 'arm32'
    if (device === 'paperpro' || device === 'move') return 'aarch64'
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
    setInstalling(true)
    setInstallCancelled(false)
    setStep('install')
    setOutput('')

    const arch = getArchitecture()
    const archTesting = arch === 'arm32' ? 'arm32-testing' : 'aarch64'

    try {
      const components = Array.from(selected)

      for (const comp of components) {
        setCurrentComponent(comp)
        setOutput((prev) => prev + `\n=== Installing ${comp} ===\n`)

        if (comp === 'xovi') {
          const script = [
            'cd /home/root',
            'test -f curl || { wget -q https://github.com/moparisern/remarkable-curl/releases/download/v0.1/curl-reMarkable2 -O curl && chmod +x curl; }',
            `./curl -Lo extensions.zip https://github.com/asivery/rm-xovi-extensions/releases/download/v16-14112025/extensions-${archTesting}.zip`,
            'unzip -o -d extensions extensions.zip && rm extensions.zip',
            'bash extensions/install-xovi-for-rm',
          ].join(' && ')
          setOutput((prev) => prev + `$ ${script}\n`)
          await runScript(script)
        }

        if (comp === 'qt-resource-rebuilder') {
          // First, copy the extension file
          const copyScript = 'cp /home/root/extensions/qt-resource-rebuilder.so /home/root/xovi/extensions.d/qt-resource-rebuilder.so'
          setOutput((prev) => prev + `$ ${copyScript}\n`)
          await runScript(copyScript)

          // Show dialog and wait for user confirmation before rebuild
          await new Promise<void>((resolve, reject) => {
            setPendingRebuildCallback({ resolve, reject })
            setShowRebuildDialog(true)
          })

          // User confirmed, run rebuild
          setRebuildInProgress(true)
          const rebuildScript = '/home/root/xovi/rebuild_hashtable'
          setOutput((prev) => prev + `$ ${rebuildScript}\n`)
          await runScript(rebuildScript)
          setRebuildInProgress(false)
        }

        if (comp === 'tripletap') {
          const script = 'cd /home/root && wget -qO- https://raw.githubusercontent.com/rmitchellscott/xovi-tripletap/main/install.sh | bash'
          setOutput((prev) => prev + `$ ${script}\n`)
          await runScript(script)
        }

        if (comp === 'rm-hacks') {
          const script = [
            'cd /home/root',
            './curl -Lo rm-hacks.zip https://github.com/asivery/rm-hacks-qmd/archive/refs/heads/master.zip',
            'unzip -o -d rm-hacks rm-hacks.zip "rm-hacks-qmd-master/0.0.11-pre3/*"',
            'cp -r rm-hacks/rm-hacks-qmd-master/0.0.11-pre3/* /home/root/xovi/exthome/qt-resource-rebuilder/',
            'rm -rf rm-hacks rm-hacks.zip',
          ].join(' && ')
          setOutput((prev) => prev + `$ ${script}\n`)
          await runScript(script)
        }

        if (comp === 'appload') {
          const script = [
            'cd /home/root',
            `./curl -Lo appload.zip https://github.com/asivery/rm-appload/releases/download/v0.4.1/appload-${arch}.zip`,
            'unzip -o -d /home/root/shims appload.zip && rm appload.zip',
            'mv /home/root/shims/appload.so /home/root/xovi/extensions.d/appload.so',
          ].join(' && ')
          setOutput((prev) => prev + `$ ${script}\n`)
          await runScript(script)
        }
      }

      setOutput((prev) => prev + '\n=== Installation complete! ===\n')
      setOutput((prev) => prev + 'Run xovi/start or triple-tap the power button to start xovi.\n')
      setStep('done')
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') {
        setOutput((prev) => prev + '\n=== Installation cancelled ===\n')
        setInstallCancelled(true)
      } else {
        setOutput((prev) => prev + `\nError: ${err}\n`)
      }
      setStep('done')
    } finally {
      setInstalling(false)
      setCurrentComponent('')
    }
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
              <Wifi className="h-4 w-4 text-green-500" />
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
            </CardContent>
          </Card>
        )}

        {step === 'select' && (
          <Card>
            <CardHeader>
              <CardTitle>Select components to install</CardTitle>
              <CardDescription>
                Choose which xovi extensions you want to install
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {COMPONENTS.map((comp) => {
                const isSelected = selected.has(comp.id)
                const isRequired = comp.id === 'xovi' && selected.size > 1

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
                        {comp.requiresQtRebuilder && (
                          <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                            requires qt-resource-rebuilder
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{comp.description}</p>
                    </div>
                  </div>
                )
              })}
              <div className="pt-4">
                <Button onClick={handleInstall} disabled={selected.size === 0}>
                  <Package className="mr-2 h-4 w-4" />
                  Install {selected.size} component{selected.size !== 1 ? 's' : ''}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {(step === 'install' || step === 'done') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {installing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Installing {currentComponent}...
                  </>
                ) : installCancelled ? (
                  <>
                    <X className="h-5 w-5 text-muted-foreground" />
                    Installation Cancelled
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5 text-green-500" />
                    Installation Complete
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] rounded-lg overflow-hidden">
                <Terminal output={output} />
              </div>
              {step === 'done' && (
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => setStep('select')}>Install More</Button>
                  <Button variant="outline" onClick={handleDisconnect}>
                    Disconnect
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

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
