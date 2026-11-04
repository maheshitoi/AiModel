"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "@/hooks/queries";
import { ApiError, api } from "@/services/api";
import type { WhatsAppAccount } from "@/types/api";

// Mirrors CreateWhatsAppAccountDto (apps/backend/src/whatsapp/whatsapp.dto.ts).
const secret = (min: number, label: string) => z.string().trim().min(min, `${label} must be at least ${min} characters`);
const base = {
  displayName: z.string().trim().min(1, "Enter a name").max(100),
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +15550102030"),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Numeric ID from the Meta app dashboard"),
  businessAccountId: z.string().trim().regex(/^\d{5,30}$/, "Numeric WhatsApp Business Account ID"),
};
const createSchema = z.object({ ...base, accessToken: secret(20, "Access token"), appSecret: secret(16, "App secret"), verifyToken: secret(16, "Verify token") });
// When editing, an empty secret means "keep the stored one".
const keepOr = (s: z.ZodString) => z.union([z.literal(""), s]);
const editSchema = z.object({
  ...base,
  accessToken: keepOr(secret(20, "Access token")),
  appSecret: keepOr(secret(16, "App secret")),
  verifyToken: keepOr(secret(16, "Verify token")),
});
type Values = z.infer<typeof createSchema>;

const FIELDS: { name: keyof Values; label: string; help: string; secret?: boolean; placeholder?: string }[] = [
  { name: "displayName", label: "Name", help: "Shown in the dashboard" },
  { name: "phoneNumber", label: "Phone number", help: "The business number, E.164", placeholder: "+15550102030" },
  { name: "phoneNumberId", label: "Phone number ID", help: "Meta app → WhatsApp → API setup" },
  { name: "businessAccountId", label: "WhatsApp Business Account ID", help: "Shown next to the phone number ID" },
  { name: "accessToken", label: "Access token", help: "A permanent system-user token with whatsapp_business_messaging", secret: true },
  { name: "appSecret", label: "App secret", help: "Meta app → Settings → Basic. Used to verify webhook signatures", secret: true },
  { name: "verifyToken", label: "Webhook verify token", help: "Any random string; enter the same value in the Meta webhook settings", secret: true },
];

export function AccountFormDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (open: boolean) => void; account?: WhatsAppAccount }) {
  const editing = !!account;
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(editing ? editSchema : createSchema) as never });

  useEffect(() => {
    if (open) {
      reset({
        displayName: account?.displayName ?? "",
        phoneNumber: account?.phoneNumber ?? "",
        phoneNumberId: account?.phoneNumberId ?? "",
        businessAccountId: account?.businessAccountId ?? "",
        accessToken: "",
        appSecret: "",
        verifyToken: "",
      });
    }
  }, [open, account, reset]);

  const submit = handleSubmit(async (values) => {
    // Never send empty secrets: on edit they mean "unchanged".
    const body = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
    try {
      if (account) await api.patch(`/whatsapp/accounts/${account.id}`, body);
      else await api.post("/whatsapp/accounts", body);
      await queryClient.invalidateQueries({ queryKey: queryKeys.whatsappAccounts });
      toast.success(editing ? "Account updated" : "Account added. Verify it to check the credentials.");
      onOpenChange(false);
    } catch (e) {
      const details = e instanceof ApiError && Array.isArray(e.details) ? `: ${e.details.join("; ")}` : "";
      setError("root", { message: e instanceof ApiError && e.status === 409 ? "This phone number ID is already connected" : `${(e as Error).message}${details}` });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${account.displayName}` : "Connect a WhatsApp number"}</DialogTitle>
          <DialogDescription>
            Credentials are encrypted before they are stored and are never shown again.
            {editing && " Leave a credential empty to keep the current one."}
          </DialogDescription>
        </DialogHeader>
        <form id="whatsapp-account-form" onSubmit={submit} noValidate className="space-y-4">
          {FIELDS.map(({ name, label, help, secret, placeholder }) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={`wa-${name}`}>{label}</Label>
              <Input
                id={`wa-${name}`}
                type={secret ? "password" : "text"}
                autoComplete="off"
                placeholder={secret && editing ? (name === "accessToken" ? `•••• ${account.accessTokenLast4}` : "••••••••") : placeholder}
                aria-invalid={!!errors[name]}
                {...register(name)}
              />
              <p className={errors[name] ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>{errors[name]?.message ?? help}</p>
            </div>
          ))}
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
          <Button type="submit" form="whatsapp-account-form" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {editing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
