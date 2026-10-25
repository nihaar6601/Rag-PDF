"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from "@clerk/nextjs";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Header() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              RagPDF
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Upload a PDF. Ask questions. Understand more.
            </p>
          </div>
        </div>

        <div className="flex h-8 shrink-0 items-center gap-2">
          {isLoaded && isSignedIn ? <UserButton /> : null}
          {isLoaded && !isSignedIn ? (
            <>
              <SignInButton mode="modal">
                <Button type="button" variant="ghost" size="sm">
                  Sign in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button type="button" size="sm">
                  Sign up
                </Button>
              </SignUpButton>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
