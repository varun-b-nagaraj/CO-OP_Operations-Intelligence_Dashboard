'use client';

import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';

type OptionItem = {
  value: string;
  label: string;
  disabled: boolean;
};

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  placeholder?: string;
};

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((item) => extractText(item)).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return '';
}

function getOptions(children: React.ReactNode): OptionItem[] {
  const options: OptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ value?: string; disabled?: boolean; children?: React.ReactNode }>(child)) return;
    if (typeof child.type !== 'string' || child.type.toLowerCase() !== 'option') return;

    const value = String(child.props.value ?? '');
    const label = extractText(child.props.children).trim() || value;
    options.push({
      value,
      label,
      disabled: Boolean(child.props.disabled)
    });
  });
  return options;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function SelectControl(
  {
    children,
    className,
    disabled,
    value,
    defaultValue,
    onChange,
    onBlur,
    name,
    required,
    placeholder,
    ...rest
  },
  forwardedRef
) {
  const localRef = useRef<HTMLSelectElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo(() => getOptions(children), [children]);

  const initialValue =
    value !== undefined
      ? String(value)
      : defaultValue !== undefined
        ? String(defaultValue)
        : options.find((item) => !item.disabled)?.value ?? '';

  const [internalValue, setInternalValue] = useState(initialValue);

  const selectedValue = value !== undefined ? String(value) : internalValue;
  const selectedOption = options.find((item) => item.value === selectedValue);
  const triggerLabel = selectedOption?.label ?? placeholder ?? 'Select';

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!localRef.current) return;
    localRef.current.value = selectedValue;
  }, [selectedValue]);

  const setRefs = (node: HTMLSelectElement | null) => {
    localRef.current = node;
    if (!forwardedRef) return;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
      return;
    }
    forwardedRef.current = node;
  };

  const commitValue = (nextValue: string) => {
    if (!localRef.current) return;
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    localRef.current.value = nextValue;
    const evt = new Event('change', { bubbles: true });
    localRef.current.dispatchEvent(evt);
  };

  return (
    <div className="relative" ref={rootRef}>
      <select
        {...rest}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-0 w-0 opacity-0"
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        onBlur={onBlur}
        onChange={onChange}
        ref={setRefs}
        required={required}
        value={selectedValue}
      >
        {children}
      </select>

      <button
        className={`flex w-full items-center justify-between rounded border border-neutral-300 bg-white px-2 text-left text-sm text-neutral-900 transition hover:border-brand-maroon disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ''}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className="truncate">{triggerLabel}</span>
        <span className={`ml-2 text-xs text-brand-maroon transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      <div
        className={`absolute z-40 mt-1 w-full rounded border border-neutral-200 bg-white shadow-lg transition-all ${
          open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'
        }`}
      >
        {options.map((option) => {
          const isSelected = option.value === selectedValue;
          return (
            <button
              className={`block w-full px-2 py-1.5 text-left text-sm ${
                isSelected
                  ? 'bg-brand-maroon text-white'
                  : 'bg-white text-neutral-800 hover:bg-neutral-100'
              } ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              disabled={option.disabled}
              key={option.value || `opt-${option.label}`}
              onClick={() => {
                if (option.disabled) return;
                commitValue(option.value);
                setOpen(false);
              }}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
