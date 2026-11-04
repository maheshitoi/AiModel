"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys, useSecuritySettings } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/services/api";

// Mirrors SecuritySettingsDto (apps/backend/src/settings/settings.dto.ts).
const int = (min: number, max: number) => z.number({ error: "Enter a number" }).int("Whole numbers only").min(min, `At least ${min}`).max(max, `At most ${max}`);
const schema = z.object({ accessTokenTtlMinutes: int(5, 1440), refreshTokenTtlDays: int(1, 90), maxFailedLogins: int(3, 20) });
type Values = z.infer<typeof schema>;

const FIELDS: { name: keyof Values; label: string; help: string }[] = [
  { name: "accessTokenTtlMinutes", label: "Access token lifetime (minutes)", help: "How long a sign-in stays valid between silent refreshes" },
  { name: "refreshTokenTtlDays", label: "Session length (days)", help: "Users must sign in again after this" },
  { name: "maxFailedLogins", label: "Failed sign-ins before lockout", help: "The account is locked for 15 minutes after this many wrong passwords" },
];

export function SecuritySettingsForm() {
  const { can } = useAuth();
  const editable = can("settings:manage");
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useSecuritySettings();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      await api.patch("/settings/security", v);
      await queryClient.invalidateQueries({ queryKey: queryKeys.securitySettings });
      toast.success("Security settings saved. They apply to new sign-ins.");
    } catch (e) {
      setError("root", { message: (e as Error).message });
    }
  });

  if (isPending) return <Skeleton className="h-56 w-full" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <fieldset disabled={!editable || isSubmitting} className="space-y-4">
        {FIELDS.map(({ name, label, help }) => (
          <div key={name} className="space-y-1.5">
            <Label htmlFor={name}>{label}</Label>
            <Input id={name} type="number" inputMode="numeric" aria-invalid={!!errors[name]} {...register(name, { valueAsNumber: true })} />
            <p className={errors[name] ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>{errors[name]?.message ?? help}</p>
          </div>
        ))}
      </fieldset>
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      {editable && (
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
          Save
        </Button>
      )}
    </form>
  );
}
