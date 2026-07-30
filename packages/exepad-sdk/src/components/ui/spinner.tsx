import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

type SpinnerSize = "sm" | "md" | "lg"

const SPINNER_SIZE_CLASS: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
}

function Spinner({
  className,
  size = "sm",
  ...props
}: Omit<React.ComponentProps<"svg">, "size"> & { size?: SpinnerSize }) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn(SPINNER_SIZE_CLASS[size], "animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
