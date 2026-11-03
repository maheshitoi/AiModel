"use client";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { SessionsTable } from "@/components/auth/sessions-table";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function AccountPage() {
  const { state } = useAuth();
  const user = state.user;

  return (
    <>
      <PageHeader title="Account & security" description="Your profile, password and signed-in devices" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="font-medium">{user?.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="font-medium">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Role</dt>
                <dd className="font-medium">{user?.role}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Changing your password signs out all other devices.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Recent sign-ins to your account (login history)</CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsTable />
        </CardContent>
      </Card>
    </>
  );
}
