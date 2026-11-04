"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRoles } from "@/hooks/queries";
import { api } from "@/services/api";
import type { UserRow } from "@/types/api";

// Mirrors CreateUserDto / UpdateUserDto and PASSWORD_MIN/MAX (apps/backend/src/users, auth/dto).
const password = z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters");
const createSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  email: z.email("Enter a valid email address").max(254),
  roleId: z.string().min(1, "Choose a role"),
  password,
  isActive: z.boolean(),
});
const editSchema = createSchema.extend({ email: z.string(), password: z.union([z.literal(""), password]) });
type Values = z.infer<typeof createSchema>;

export function UserDialog({ open, onOpenChange, user, isSelf }: { open: boolean; onOpenChange: (o: boolean) => void; user?: UserRow; isSelf?: boolean }) {
  const editing = !!user;
  const queryClient = useQueryClient();
  const roles = useRoles();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(editing ? editSchema : createSchema) as never });

  useEffect(() => {
    if (open) reset({ name: user?.name ?? "", email: user?.email ?? "", roleId: user?.role.id ?? "", password: "", isActive: user?.isActive ?? true });
  }, [open, user, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      if (user) {
        const body: Record<string, unknown> = { name: v.name, roleId: v.roleId, isActive: v.isActive, ...(v.password && { password: v.password }) };
        await api.patch(`/users/${user.id}`, body);
      } else {
        await api.post("/users", { name: v.name, email: v.email, roleId: v.roleId, password: v.password });
      }
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(editing ? (v.password ? "User updated and signed out everywhere" : "User updated") : "User created");
      onOpenChange(false);
    } catch (e) {
      setError("root", { message: (e as Error).message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${user.name}` : "Add a user"}</DialogTitle>
          <DialogDescription>{editing ? "Resetting the password or deactivating signs the user out everywhere." : "They sign in with this email and password."}</DialogDescription>
        </DialogHeader>
        <form id="user-form" onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input id="user-name" aria-invalid={!!errors.name} {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input id="user-email" type="email" autoComplete="off" disabled={editing} aria-invalid={!!errors.email} {...register("email")} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-role">Role</Label>
            <Controller
              control={control}
              name="roleId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isSelf}>
                  <SelectTrigger id="user-role" className="w-full" aria-invalid={!!errors.roleId}>
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roles.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name.charAt(0) + r.name.slice(1).toLowerCase()} · {r.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.roleId && <p className="text-sm text-destructive">{errors.roleId.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-password">{editing ? "New password (optional)" : "Password"}</Label>
            <Input id="user-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{editing ? "Leave empty to keep the current password." : "At least 12 characters."}</p>
            )}
          </div>
          {editing && !isSelf && (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="user-active">Active</Label>
              <Controller control={control} name="isActive" render={({ field }) => <Switch id="user-active" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          )}
          {errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {editing ? "Save" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
