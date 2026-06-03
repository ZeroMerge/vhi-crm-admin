
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  value?: Date | string;
  onChange: (date: Date | undefined) => void;
  className?: string;
  placeholder?: string;
}

export function DatePicker({ value, onChange, className, placeholder = "Pick a date" }: DatePickerProps) {
  const dateValue = typeof value === 'string' && value ? new Date(value) : (value as Date | undefined);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '36px',
            padding: '0 12px',
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: 'var(--radius-input, 4px)',
            color: dateValue ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-sm, 14px)',
            width: '200px',
            textAlign: 'left'
          }}
          className={className}
        >
          <CalendarIcon size={16} style={{ marginRight: 8, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{dateValue ? format(dateValue, "MMM dd, yyyy") : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        align="start"
        style={{
          background: 'var(--color-surface, #fff)',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: 'var(--radius-card, 4px)',
          boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1))',
          padding: '16px',
          zIndex: 1000,
          width: 'max-content'
        }}
      >
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={onChange}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}
