"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"

import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <div className={cn("p-3 bg-white border border-gray-200 rounded-[4px] shadow-sm", className)} style={{ 
      
      '--rdp-accent-color': 'var(--color-primary)',
      '--rdp-background-color': 'var(--color-primary-light)',
      '--rdp-accent-color-dark': 'var(--color-primary)',
      '--rdp-background-color-dark': 'var(--color-primary-light)',
      '--rdp-outline-color': 'var(--color-primary)',
      '--rdp-outline-color-dark': 'var(--color-primary)',
    } as React.CSSProperties}>
      <DayPicker
        showOutsideDays={showOutsideDays}
        {...props}
      />
    </div>
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
