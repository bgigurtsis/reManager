declare module '*/wailsjs/go/main/App' {
  export function Connect(host: string, password: string): Promise<{
    success: boolean
    message: string
    device?: string
  }>
  export function Disconnect(): Promise<void>
  export function IsConnected(): Promise<boolean>
  export function RunCommand(cmd: string): Promise<string>
  export function RunCommandWithOutput(cmd: string): Promise<void>
  export function GetDeviceInfo(): Promise<Record<string, string>>
}

declare module '*/wailsjs/runtime/runtime' {
  export function EventsOn(eventName: string, callback: (...args: any[]) => void): () => void
  export function EventsOff(eventName: string): void
  export function EventsEmit(eventName: string, ...args: any[]): void
}
