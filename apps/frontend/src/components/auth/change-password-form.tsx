"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "@/hooks/queries";
import { api } from "@/services/api";

// Mirrors PASSWORD_MIN / PASSWORD_MAX in apps/backend/src/auth/dto/auth.dto.ts
const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a different password" });

type Values = z.infer<typeof schema>;

const FIELDS: { name: keyof Values; label: string; autoComplete: string }[] = [
  { name: "currentPassword", label: "Current password", autoComplete: "current-password" },
  { name: "newPassword", label: "New password", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Confirm new password", autoComplete: "new-password" },
];

export function ChangePasswordForm() {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      toast.success("Password changed. Other devices have been signed out.");
    } catch (error) {
      setError("currentPassword", { message: error instanceof Error ? error.message : "Could not change password" });
    }
  });

  return (
    <form onSubmit={submit} noValidate className="max-w-sm space-y-4">
      {FIELDS.map(({ name, label, autoComplete }) => (
        <div key={name} className="space-y-1.5">
          <Label htmlFor={name}>{label}</Label>
          <Input id={name} type="password" autoComplete={autoComplete} aria-invalid={!!errors[name]} {...register(name)} />
          {errors[name] && <p className="text-sm text-destructive">{errors[name]?.message}</p>}
        </div>
      ))}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Change password
      </Button>
    </form>
  );
}
