"use client";

import { AiPlayground } from "@/components/ai/ai-playground";
import { AiStatusCard } from "@/components/ai/ai-status-card";
import { GenerationSettingsForm } from "@/components/ai/generation-settings-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function AiSettingsPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="AI settings" description="The active model, how it generates replies, and a playground to try it" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          {can("models:read") && <AiStatusCard />}
          {can("conversations:reply") && (
            <Card>
              <CardHeader>
                <CardTitle>Try the AI</CardTitle>
                <CardDescription>Runs the full pipeline (safety rules, model, checks). Nothing is sent to WhatsApp.</CardDescription>
              </CardHeader>
              <CardContent>
                <AiPlayground />
              </CardContent>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Generation</CardTitle>
            <CardDescription>Applies to every AI reply. Changes are audited.</CardDescription>
          </CardHeader>
          <CardContent>
            <GenerationSettingsForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
