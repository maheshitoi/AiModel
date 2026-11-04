"use client";

import { Copy, Phone, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountCard } from "@/components/whatsapp/account-card";
import { AccountFormDialog } from "@/components/whatsapp/account-form-dialog";
import { useWhatsAppAccounts } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { API_URL } from "@/services/api";

const WEBHOOK_URL = `${API_URL}/webhooks/whatsapp`;

export default function WhatsAppSettingsPage() {
  const { can } = useAuth();
  const canManage = can("whatsapp:manage");
  const [adding, setAdding] = useState(false);
  const { data, isPending, isError, error, refetch } = useWhatsAppAccounts();

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Your WhatsApp Business numbers, connected through the official Cloud API"
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Connect number
            </Button>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>In your Meta app: WhatsApp → Configuration → Webhook. Then subscribe to the &ldquo;messages&rdquo; field.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Callback URL</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">{WEBHOOK_URL}</code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy callback URL"
                onClick={() => navigator.clipboard.writeText(WEBHOOK_URL).then(() => toast.success("Copied"))}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground">
            Verify token: the one you entered for the number. Meta only calls public HTTPS addresses, so for local testing expose the
            backend with a tunnel and set <code>NEXT_PUBLIC_API_URL</code> to it. Every call is checked against the app secret&apos;s
            signature.
          </p>
        </CardContent>
      </Card>

      {isPending ? (
        <Skeleton className="h-56 w-full" />
      ) : isError ? (
        <Card>
          <ErrorState message={error.message} onRetry={() => refetch()} />
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Phone}
            title="No number connected"
            description="Connect your WhatsApp Business number to receive customer messages and send AI replies."
            action={canManage && <Button onClick={() => setAdding(true)}>Connect number</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data.map((a) => (
            <AccountCard key={a.id} account={a} canManage={canManage} />
          ))}
        </div>
      )}

      <AccountFormDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
