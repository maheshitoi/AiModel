import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetDialog } from "@/components/datasets/dataset-dialog";
import { UploadDatasetDialog } from "@/components/datasets/upload-dialog";
import type { DatasetRow, TrainingJob, TrainingMetricPoint } from "@/types/api";
import { JobCard } from "./job-card";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), upload: vi.fn() }));
vi.mock("@/services/api", () => ({ api }));
const permissions = vi.hoisted(() => ({ list: ["*"] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ can: (p: string) => permissions.list.includes("*") || permissions.list.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const dataset: DatasetRow = {
  id: "d1",
  name: "chats",
  version: 2,
  description: null,
  fileName: "chats.jsonl",
  format: "JSONL",
  sizeBytes: 1200,
  recordCount: 3,
  duplicateCount: 1,
  validationErrors: { issueCount: 0, issues: [] },
  stats: { records: 3, valid_records: 3, dropped_after_cleaning: 0, duplicates: 1, unique: 2, train: 1, validation: 1, turns: 4, intents: {} },
  status: "VALID",
  isActive: false,
  containsCustomerData: true,
  approvedAt: null,
  createdAt: "2026-11-04T00:00:00Z",
  uploadedBy: { id: "u1", name: "Admin" },
  approvedBy: null,
  _count: { trainingJobs: 0 },
};

beforeEach(() => {
  permissions.list = ["*"];
  api.get.mockReset().mockResolvedValue({ total: 2, items: [{ messages: [{ role: "customer", text: "Call me on <phone>" }, { role: "assistant", text: "Sure." }], source: "x" }] });
  api.post.mockReset().mockResolvedValue({});
  api.upload.mockReset().mockResolvedValue({ ...dataset, status: "VALID" });
});

describe("DatasetDialog", () => {
  it("shows the report and the masked preview", async () => {
    wrap(<DatasetDialog dataset={dataset} onClose={vi.fn()} />);
    expect(screen.getByText("1 / 1")).toBeInTheDocument(); // train / validation split
    expect(await screen.findByText("Call me on <phone>")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/datasets/d1/preview", { query: { offset: 0, limit: 10 } });
  });

  it("requires confirming the review before approving customer data", async () => {
    const onClose = vi.fn();
    wrap(<DatasetDialog dataset={dataset} onClose={onClose} />);
    const approve = screen.getByRole("button", { name: "Approve for training" });
    expect(approve).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: /I have read these conversations/ }));
    await userEvent.click(approve);
    expect(api.post).toHaveBeenCalledWith("/datasets/d1/approve", { reviewedCustomerData: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("lists problems and offers no approval for an invalid file", () => {
    wrap(<DatasetDialog dataset={{ ...dataset, status: "INVALID", validationErrors: { issueCount: 1, issues: [{ record: 4, message: "turn 1: text is empty" }] } }} onClose={vi.fn()} />);
    expect(screen.getByText("Record 4: turn 1: text is empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve for training" })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("is read-only without datasets:manage", () => {
    permissions.list = ["datasets:read"];
    wrap(<DatasetDialog dataset={dataset} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Approve for training" })).not.toBeInTheDocument();
  });
});

describe("UploadDatasetDialog", () => {
  it("names the dataset after the file and sends it as multipart form data", async () => {
    const onUploaded = vi.fn();
    wrap(<UploadDatasetDialog open onOpenChange={vi.fn()} onUploaded={onUploaded} />);
    const file = new File(['{"messages": []}'], "clinic faq.jsonl");
    await userEvent.upload(screen.getByLabelText("File"), file);
    expect(screen.getByLabelText("Name")).toHaveValue("clinic faq");
    await userEvent.click(screen.getByRole("switch", { name: "Contains real customer conversations" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    const [path, form] = api.upload.mock.calls[0] as [string, FormData];
    expect(path).toBe("/datasets");
    expect(form.get("name")).toBe("clinic faq");
    expect(form.get("containsCustomerData")).toBe("true");
    expect((form.get("file") as File).name).toBe("clinic faq.jsonl");
    expect(onUploaded).toHaveBeenCalled();
  });

  it("rejects unsupported files before uploading", async () => {
    wrap(<UploadDatasetDialog open onOpenChange={vi.fn()} onUploaded={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("File"), new File(["a,b"], "data.csv"), { applyAccept: false });
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use a .json, .jsonl or .txt file");
    expect(api.upload).not.toHaveBeenCalled();
  });
});

describe("JobCard", () => {
  const job: TrainingJob = {
    id: "j1",
    status: "RUNNING",
    runName: "tiny-cpu-20261104",
    device: "cpu",
    config: { preset: "tiny-cpu", maxSteps: null, includeSynthetic: true },
    currentStep: 250,
    totalSteps: 1000,
    currentEpoch: 1.25,
    bestValLoss: 0.5,
    errorMessage: null,
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    finishedAt: null,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
    startedBy: { id: "u1", name: "Admin" },
    modelVersion: null,
    datasets: [{ id: "d1", name: "chats", version: 2 }],
  };
  const metrics: TrainingMetricPoint[] = [
    { step: 200, epoch: 1, trainLoss: 0.9, valLoss: null, learningRate: 0.001, tokensPerSec: 3300, cpuPercent: 97, memoryMb: 450, createdAt: "" },
    { step: 250, epoch: 1.25, trainLoss: 0.8, valLoss: 0.55, learningRate: 0.00099, tokensPerSec: 3400, cpuPercent: 98, memoryMb: 460, createdAt: "" },
  ];

  it("shows progress, losses, resources and the device honestly", () => {
    wrap(<JobCard job={job} metrics={metrics} />);
    expect(screen.getByRole("progressbar", { name: "Training progress" })).toHaveAttribute("aria-valuenow", "250");
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("0.8000")).toBeInTheDocument(); // latest training loss
    expect(screen.getByText("0.5500")).toBeInTheDocument(); // latest validation loss
    expect(screen.getByText("best 0.5000")).toBeInTheDocument();
    expect(screen.getByText("no CUDA GPU: training on the CPU")).toBeInTheDocument();
    expect(screen.getByText(/^1 min 0[5-9] s$/)).toBeInTheDocument();
  });

  it("asks before stopping, then stops the job", async () => {
    wrap(<JobCard job={job} metrics={metrics} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
    expect(api.post).toHaveBeenCalledWith("/training/jobs/j1/stop");
  });

  it("hides the stop button from read-only users", () => {
    permissions.list = ["training:read"];
    wrap(<JobCard job={job} metrics={metrics} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });
});
