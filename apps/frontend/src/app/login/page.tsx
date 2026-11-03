"use client";

import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage() {
  const { state, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "authenticated") router.replace("/");
  }, [state.status, router]);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Bot className="mx-auto mb-2 size-8 text-primary" aria-hidden />
          <CardTitle className="text-xl">Sign in to My Own AI</CardTitle>
          <CardDescription>Manage your AI model and WhatsApp automation</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm onSubmit={({ email, password }) => login(email, password)} />
        </CardContent>
      </Card>
    </div>
  );
}
