import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all__";

/** A labelled dropdown filter whose first option clears it (value undefined). */
export function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: { value: T; label: string }[];
  allLabel?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : (v as T))}>
      <SelectTrigger aria-label={label} className="w-full sm:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
