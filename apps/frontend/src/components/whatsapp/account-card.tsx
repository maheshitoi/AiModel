"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Pencil, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/hooks/queries";
import { formatRelative } from "@/lib/format";
import { api } from "@/services/api";
import type { WhatsAppAccount, WhatsAppAccountStatus } from "@/types/api";
import { AccountFormDialog } from "./account-form-dialog";

const STATUS: Record<WhatsAppAccountStatus, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  CONNECTED: { label: "Connected", variant: "secondary" },
  PENDING: { label: "Not verified", variant: "outline" },
  ERROR: { label: "Error", variant: "destructive" },
  DISABLED: { label: "Disabled", variant: "outline" },
};

export function AccountCard({ account, canManage }: { account: WhatsAppAccount; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.whatsappAccounts });

  const verify = useMutation({
    mutationFn: () => api.post<WhatsAppAccount & { verification: { ok: boolean; message: string } }>(`/whatsapp/accounts/${account.id}/verify`),
    onSuccess: (r) => {
      if (r.verification.ok) toast.success(r.verification.message);
      else toast.error(`Verification failed: ${r.verification.message}`);
      return refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: (patch: Partial<{ autoReplyEnabled: boolean; enabled: boolean }>) => api.patch(`/whatsapp/accounts/${account.id}`, patch),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message),
  });

  const status = STATUS[account.status];
  const disabled = account.status === "DISABLED";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{account.displayName}</CardTitle>
        <CardDescription>{account.phoneNumber}</CardDescription>
        <CardAction>
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Phone number ID</dt>
            <dd className="font-medium break-all">{account.phoneNumberId}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Access token</dt>
            <dd className="font-medium">•••• {account.accessTokenLast4}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last verified</dt>
            <dd className="font-medium">{formatRelative(account.lastVerifiedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last webhook received</dt>
            <dd className="font-medium">{formatRelative(account.lastWebhookAt)}</dd>
          </div>
        </dl>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor={`auto-${account.id}`}>Send AI replies automatically</Label>
            <p className="text-xs text-muted-foreground">
              {account.autoReplyEnabled
                ? "On: AI replies go out without staff approval."
                : "Off: AI replies wait in the inbox for staff to approve. Emergency replies are still sent at once."}
            </p>
          </div>
          <Switch
            id={`auto-${account.id}`}
            checked={account.autoReplyEnabled}
            disabled={!canManage || update.isPending || disabled}
            onCheckedChange={(on) => (on ? setConfirmAuto(true) : update.mutate({ autoReplyEnabled: false }))}
          />
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={verify.isPending || disabled} onClick={() => verify.mutate()}>
              {verify.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
              Verify credentials
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Button>
            <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => update.mutate({ enabled: disabled })}>
              {disabled ? "Enable" : "Disable"}
            </Button>
          </div>
        )}
      </CardContent>

      <AccountFormDialog open={editing} onOpenChange={setEditing} account={account} />
      <Dialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send AI replies without approval?</DialogTitle>
            <DialogDescription>
              The current model answers familiar questions well but still gets some unfamiliar ones wrong (3 of 22 test prompts, see
              docs/inference.md). Safety rules and checks stay on, but staff will no longer see replies before customers do.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAuto(false)}>
              Keep approval
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmAuto(false);
                update.mutate({ autoReplyEnabled: true });
              }}
            >
              Turn on auto-reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
