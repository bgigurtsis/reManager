import { CommandResult } from '../types'

export class CommandExecutor {
  constructor(private executeCommand: (cmd: string) => Promise<boolean>) {}

  async execute(command: CommandResult | CommandResult[] | null): Promise<boolean> {
    if (!command) return true

    const commands = Array.isArray(command) ? command : [command]

    for (const cmd of commands) {
      const success = await this.executeCommand(cmd.script)
      if (!success) {
        return false
      }
    }

    return true
  }
}
