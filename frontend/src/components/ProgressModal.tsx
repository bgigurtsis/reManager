import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Terminal } from '@/components/Terminal'

interface ProgressModalProps {
  title: string
  progressText: string
  percentage: number
  terminalOutput: string
  isComplete: boolean
  onClose: () => void
}

export function ProgressModal({
  title,
  progressText,
  percentage,
  terminalOutput,
  isComplete,
  onClose,
}: ProgressModalProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm font-medium text-center text-foreground">
          {progressText}
        </p>
        <Progress value={percentage} />
        <div className="h-[400px] rounded-lg overflow-hidden">
          <Terminal output={terminalOutput} />
        </div>
      </div>
      {isComplete && (
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      )}
    </>
  )
}
