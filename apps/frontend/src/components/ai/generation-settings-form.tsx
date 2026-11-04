"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys, useAiSettings } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, api } from "@/services/api";
import type { AiGenerationSettings } from "@/types/api";

// Mirrors AiGenerationSettingsDto (apps/backend/src/settings/settings.dto.ts); the API validates again.
const num = (min: number, max: number, int = false) => {
  const base = z.number({ error: "Enter a number" }).min(min, `At least ${min}`).max(max, `At most ${max}`);
  return int ? base.int("Whole numbers only") : base;
};
const schema = z.object({
  minConfidence: num(0, 1),
  historyMessages: num(1, 50, true),
  maxNewTokens: num(1, 512, true),
  temperature: num(0, 2),
  topK: num(0, 1000, true),
  topP: num(0.01, 1),
  maxContextTokens: num(16, 4096, true),
  fallbackReply: z.string().trim().min(1, "Enter a fallback reply").max(1000),
  sendSafetyRepliesImmediately: z.boolean(),
});
type Values = z.infer<typeof schema>;

const NUMBER_FIELDS: { name: Exclude<keyof Values, "fallbackReply" | "sendSafetyRepliesImmediately">; label: string; help: string; step: string }[] = [
  { name: "minConfidence", label: "Minimum confidence", help: "Replies less sure than this get the fallback reply (0–1). Evaluated at 0.5.", step: "0.05" },
  { name: "historyMessages", label: "Context messages", help: "Recent messages the model sees", step: "1" },
  { name: "maxNewTokens", label: "Max reply tokens", help: "Longest reply the model may write", step: "1" },
  { name: "temperature", label: "Temperature", help: "0 = always the most likely reply (evaluated setting)", step: "0.1" },
  { name: "topK", label: "Top-k", help: "0 disables", step: "1" },
  { name: "topP", label: "Top-p", help: "1 disables", step: "0.05" },
  { name: "maxContextTokens", label: "Max context tokens", help: "Cannot exceed the active model's context length", step: "1" },
];

export function GenerationSettingsForm() {
  const { can } = useAuth();
  const editable = can("settings:manage");
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useAiSettings();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await api.patch<AiGenerationSettings>("/settings/ai.generation", values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiSettings });
      toast.success("AI settings saved");
    } catch (e) {
      const details = e instanceof ApiError && Array.isArray(e.details) ? `: ${e.details.join("; ")}` : "";
      setError("root", { message: `${e instanceof Error ? e.message : "Could not save"}${details}` });
    }
  });

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={!editable || isSubmitting} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBER_FIELDS.map(({ name, label, help, step }) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={name}>{label}</Label>
              <Input id={name} type="number" step={step} inputMode="decimal" aria-invalid={!!errors[name]} aria-describedby={`${name}-help`} {...register(name, { valueAsNumber: true })} />
              <p id={`${name}-help`} className={errors[name] ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                {errors[name]?.message ?? help}
              </p>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fallbackReply">Fallback reply</Label>
          <Textarea id="fallbackReply" rows={2} aria-invalid={!!errors.fallbackReply} {...register("fallbackReply")} />
          <p className={errors.fallbackReply ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
            {errors.fallbackReply?.message ?? "Sent when the model's reply is rejected. A team member is flagged to follow up."}
          </p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="sendSafetyRepliesImmediately">Send emergency replies immediately</Label>
            <p className="text-xs text-muted-foreground">
              Emergency and self-harm messages get the fixed safety reply at once, even while auto-reply is off. Recommended.
            </p>
          </div>
          <Controller
            control={control}
            name="sendSafetyRepliesImmediately"
            render={({ field }) => <Switch id="sendSafetyRepliesImmediately" checked={field.value} onCheckedChange={field.onChange} />}
          />
        </div>
      </fieldset>
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      {editable ? (
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Save settings
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">You can view these settings; changing them needs the settings:manage permission.</p>
      )}
    </form>
  );
}
