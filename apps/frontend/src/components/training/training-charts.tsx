"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { TrainingMetricPoint } from "@/types/api";

// Loss: two series in one unit, so one axis; categorical slots 1 and 2 in fixed order.
const TRAIN = "var(--chart-1)";
const VAL = "var(--chart-2)";
const axis = { tick: { fill: "var(--muted-foreground)", fontSize: 12 }, tickLine: false } as const;
const loss = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(4));
const lr = (v: number) => v.toExponential(1);

function Legend() {
  return (
    <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded" style={{ background: TRAIN }} aria-hidden />
        Training loss
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: VAL }} aria-hidden />
        Validation loss
      </li>
    </ul>
  );
}

function Tip({ active, payload, render }: { active?: boolean; payload?: readonly { payload?: unknown }[]; render: (p: TrainingMetricPoint) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as TrainingMetricPoint;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">
        Step {formatNumber(p.step)} · epoch {p.epoch.toFixed(2)}
      </p>
      {render(p)}
    </div>
  );
}

export function TrainingCharts({ metrics }: { metrics: TrainingMetricPoint[] }) {
  const [table, setTable] = useState(false);
  const toggle = (
    <Button variant="outline" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
      {table ? "Charts" : "Table"}
    </Button>
  );

  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loss</CardTitle>
          <CardDescription>The first numbers appear after the dataset is built and training has run a few steps.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (table) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Training metrics</CardTitle>
            <CardDescription>Every logged step, newest first</CardDescription>
          </div>
          {toggle}
        </CardHeader>
        <CardContent className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Step</TableHead>
                <TableHead className="text-right">Epoch</TableHead>
                <TableHead className="text-right">Training loss</TableHead>
                <TableHead className="text-right">Validation loss</TableHead>
                <TableHead className="text-right">Learning rate</TableHead>
                <TableHead className="text-right">Tokens/s</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...metrics].reverse().map((m) => (
                <TableRow key={m.step}>
                  <TableCell className="text-right tabular-nums">{formatNumber(m.step)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.epoch.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{loss(m.trainLoss)}</TableCell>
                  <TableCell className="text-right tabular-nums">{loss(m.valLoss)}</TableCell>
                  <TableCell className="text-right tabular-nums">{lr(m.learningRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.tokensPerSec === null ? "—" : formatNumber(m.tokensPerSec)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Loss</CardTitle>
            <Legend />
          </div>
          {toggle}
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metrics} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="step" type="number" domain={[0, "dataMax"]} tickFormatter={(v: number) => formatNumber(v)} {...axis} axisLine={{ stroke: "var(--border)" }} />
              <YAxis {...axis} axisLine={false} width={48} tickFormatter={(v: number) => v.toFixed(1)} />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                content={({ active, payload }) => (
                  <Tip
                    active={active}
                    payload={payload}
                    render={(p) => (
                      <>
                        <p>Training {loss(p.trainLoss)}</p>
                        {p.valLoss !== null && <p>Validation {loss(p.valLoss)}</p>}
                      </>
                    )}
                  />
                )}
              />
              <Line dataKey="trainLoss" stroke={TRAIN} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="valLoss" stroke={VAL} strokeWidth={2} dot={{ r: 4, fill: VAL, stroke: "var(--card)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Learning rate</CardTitle>
          <CardDescription>Warm-up, then cosine decay</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metrics} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="step" type="number" domain={[0, "dataMax"]} tickFormatter={(v: number) => formatNumber(v)} {...axis} axisLine={{ stroke: "var(--border)" }} />
              <YAxis {...axis} axisLine={false} width={56} tickFormatter={lr} />
              <Tooltip cursor={{ stroke: "var(--border)" }} content={({ active, payload }) => <Tip active={active} payload={payload} render={(p) => <p>{lr(p.learningRate)}</p>} />} />
              <Line dataKey="learningRate" stroke={TRAIN} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
