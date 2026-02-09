import type { Route } from './+types/home';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Link } from 'react-router';
import { baseOptions } from '@/lib/layout.shared';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'DatabaseChat Docs' },
    {
      name: 'description',
      content: 'Documentation for the DatabaseChat Convex component.',
    },
  ];
}

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -left-32 -top-24 h-72 w-72 rounded-full bg-fd-primary opacity-10 blur-3xl" />
          <div className="absolute right-0 top-24 h-72 w-72 rounded-full bg-fd-accent opacity-30 blur-3xl" />
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pb-10 pt-16 sm:pt-20">
          <h1 className="mt-6 text-4xl font-semibold text-fd-foreground sm:text-6xl animate-rise animate-rise-delay-1">
            DatabaseChat
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-fd-foreground sm:text-xl animate-rise animate-rise-delay-2">
            Ship a production-ready database chat in minutes.
          </p>
          <p className="mt-3 max-w-2xl text-base text-fd-muted-foreground sm:text-lg animate-rise animate-rise-delay-3">
            Add natural language database queries to your app with streaming responses,
            tool calling, and a set of React hooks built for Convex.
          </p>
          <ul className="mt-6 grid max-w-2xl gap-3 text-sm text-fd-muted-foreground sm:text-base animate-rise">
            <li className="flex items-start gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-fd-primary" />
              <span>
                <span className="font-semibold text-fd-foreground">Typed tools</span> that map
                Convex queries to model-friendly function calls.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-fd-primary" />
              <span>
                <span className="font-semibold text-fd-foreground">Streaming UI</span> built on
                delta updates for smooth, efficient chat.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-fd-primary" />
              <span>
                <span className="font-semibold text-fd-foreground">Drop-in hooks</span> for
                conversations, messages, and abort control.
              </span>
            </li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-3 animate-rise">
            <Link
              className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground shadow-sm transition hover:opacity-90"
              to="/docs/quick-start"
            >
              Quick Start
            </Link>
            <Link
              className="rounded-full border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground shadow-sm transition hover:bg-fd-accent"
              to="/docs"
            >
              Read the docs
            </Link>
            <a
              className="rounded-full border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground shadow-sm transition hover:bg-fd-accent"
              href="https://convex-database-chat-production.up.railway.app/"
              rel="noreferrer"
              target="_blank"
            >
              View live example
            </a>
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pb-12">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-fd-muted-foreground animate-rise">
                How it works
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-fd-foreground sm:text-3xl animate-rise animate-rise-delay-1">
                From tools to streaming UI
              </h2>
            </div>
            <p className="max-w-xl text-sm text-fd-muted-foreground sm:text-base animate-rise">
              Define tools, start conversations, and stream responses into your app with
              minimal glue code.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-fd-border bg-fd-card p-5 animate-fade">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-fd-primary text-sm font-semibold text-fd-primary-foreground">
                  1
                </div>
                <h3 className="text-base font-semibold text-fd-foreground">Define tools</h3>
              </div>
              <p className="mt-3 text-sm text-fd-muted-foreground">
                Register Convex queries and mutations as typed tools with clear descriptions.
              </p>
            </div>
            <div className="rounded-2xl border border-fd-border bg-fd-card p-5 animate-fade animate-rise-delay-1">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-fd-primary text-sm font-semibold text-fd-primary-foreground">
                  2
                </div>
                <h3 className="text-base font-semibold text-fd-foreground">Start a thread</h3>
              </div>
              <p className="mt-3 text-sm text-fd-muted-foreground">
                Create a conversation, load history, and hand off to the chat hooks.
              </p>
            </div>
            <div className="rounded-2xl border border-fd-border bg-fd-card p-5 animate-fade animate-rise-delay-2">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-fd-primary text-sm font-semibold text-fd-primary-foreground">
                  3
                </div>
                <h3 className="text-base font-semibold text-fd-foreground">Stream replies</h3>
              </div>
              <p className="mt-3 text-sm text-fd-muted-foreground">
                Stream deltas into the UI, show progress, and support user aborts.
              </p>
            </div>
          </div>
        </div>
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-6 pb-16 md:grid-cols-3">
          <div className="rounded-2xl border border-fd-border bg-fd-card p-5 animate-fade">
            <p className="text-sm font-semibold text-fd-foreground">Delta-based streaming</p>
            <p className="mt-2 text-sm text-fd-muted-foreground">
              Efficient O(n) streaming with client-side accumulation and clean stream lifecycle.
            </p>
          </div>
          <div className="rounded-2xl border border-fd-border bg-fd-card p-5 animate-fade animate-rise-delay-1">
            <p className="text-sm font-semibold text-fd-foreground">Tool calling</p>
            <p className="mt-2 text-sm text-fd-muted-foreground">
              Define the queries your LLM can run, from explicit tools to schema-driven helpers.
            </p>
          </div>
          <div className="rounded-2xl border border-fd-border bg-fd-card p-5 animate-fade animate-rise-delay-2">
            <p className="text-sm font-semibold text-fd-foreground">React hooks</p>
            <p className="mt-2 text-sm text-fd-muted-foreground">
              Drop-in hooks for messages, streaming content, smooth text, and conversations.
            </p>
          </div>
        </div>
      </div>
    </HomeLayout>
  );
}
